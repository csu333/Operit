package com.ai.assistance.operit.api.chat.llmprovider

import android.content.Context
import android.os.Environment
import com.ai.assistance.operit.R
import com.ai.assistance.operit.core.chat.hooks.PromptTurn
import com.ai.assistance.operit.core.chat.hooks.PromptTurnKind
import com.ai.assistance.operit.data.model.ApiProviderType
import com.ai.assistance.operit.data.model.ModelOption
import com.ai.assistance.operit.data.model.ModelParameter
import com.ai.assistance.operit.data.model.ToolPrompt
import com.ai.assistance.operit.util.AppLogger
import com.ai.assistance.operit.util.ChatUtils
import com.ai.assistance.operit.util.stream.Stream
import com.ai.assistance.operit.util.stream.stream
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext

/**
 * Google LiteRT-LM on-device inference (the runtime behind AI Edge Gallery).
 *
 * Loads `.litertlm` model files and runs them on the CPU, GPU, NPU or Google Tensor backend.
 * Tools are exposed through the prompt (CLI mode), not through native tool calling.
 */
class LiteRtLmProvider(
    private val context: Context,
    private val modelName: String,
    private val backendName: String,
    private val maxNumTokens: Int,
    private val threadCount: Int,
    private val providerType: ApiProviderType = ApiProviderType.LITERT_LM
) : AIService {

    companion object {
        private const val TAG = "LiteRtLmProvider"
        const val SOURCE_LITERT_LM = "litert_lm"

        const val BACKEND_GPU = "GPU"
        const val BACKEND_CPU = "CPU"
        const val BACKEND_NPU = "NPU"
        const val BACKEND_GOOGLE_TENSOR = "GOOGLE_TENSOR"
        val BACKENDS = listOf(BACKEND_GPU, BACKEND_CPU, BACKEND_NPU, BACKEND_GOOGLE_TENSOR)

        fun getModelsDir(): File {
            return File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "Operit/models/litertlm"
            )
        }

        fun getModelFile(modelName: String): File {
            return File(getModelsDir(), modelName)
        }

        // A loaded engine holds the whole model in memory; keep a single one shared across
        // provider instances so that refreshing services does not load the model twice.
        private val engineLock = Any()
        private var sharedEngine: Engine? = null
        private var sharedEngineKey: String? = null

        private fun releaseSharedEngineLocked() {
            sharedEngine?.let { engine ->
                runCatching { engine.close() }
                    .onFailure { AppLogger.w(TAG, "Failed to close LiteRT-LM engine", it) }
            }
            sharedEngine = null
            sharedEngineKey = null
        }
    }

    private var _inputTokenCount: Long = 0L
    private var _outputTokenCount: Long = 0L

    @Volatile
    private var isCancelled = false

    @Volatile
    private var activeConversation: com.google.ai.edge.litertlm.Conversation? = null

    override val inputTokenCount: Long
        get() = _inputTokenCount

    override val cachedInputTokenCount: Long
        get() = 0L

    override val outputTokenCount: Long
        get() = _outputTokenCount

    override val providerModel: String
        get() = "${providerType.name}:$modelName"

    override fun resetTokenCounts() {
        _inputTokenCount = 0L
        _outputTokenCount = 0L
    }

    override fun cancelStreaming() {
        isCancelled = true
        activeConversation?.let { conversation ->
            runCatching { conversation.cancelProcess() }
        }
    }

    override fun release() {
        synchronized(engineLock) {
            releaseSharedEngineLocked()
        }
    }

    override suspend fun getModelsList(context: Context): Result<List<ModelOption>> {
        return ModelListFetcher.getLiteRtLmLocalModels(context)
    }

    override suspend fun testConnection(context: Context): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            ensureEngine()
            "LiteRT-LM engine loaded ($backendName)."
        }
    }

    override suspend fun calculateInputTokens(
        chatHistory: List<PromptTurn>,
        availableTools: List<ToolPrompt>?
    ): Long {
        // LiteRT-LM exposes no standalone tokenizer; approximate with ~4 characters per token.
        val chars = chatHistory.sumOf { it.content.length.toLong() }
        return chars / 4
    }

    private fun buildBackend(): Backend {
        return when (backendName.uppercase()) {
            BACKEND_CPU -> Backend.CPU(threadCount = threadCount.takeIf { it > 0 })
            BACKEND_NPU -> Backend.NPU(nativeLibraryDir = context.applicationInfo.nativeLibraryDir)
            BACKEND_GOOGLE_TENSOR -> Backend.GOOGLE_TENSOR()
            else -> Backend.GPU()
        }
    }

    private fun ensureEngine(): Engine {
        val modelFile = getModelFile(modelName)
        if (modelName.isBlank() || !modelFile.exists()) {
            throw IOException(
                context.getString(R.string.litertlm_error_model_file_not_exist, modelFile.absolutePath)
            )
        }
        val key = "${modelFile.absolutePath}|$backendName|$maxNumTokens|$threadCount"
        synchronized(engineLock) {
            val existing = sharedEngine
            if (existing != null && sharedEngineKey == key && existing.isInitialized()) {
                return existing
            }
            releaseSharedEngineLocked()

            AppLogger.d(TAG, "Loading LiteRT-LM model ${modelFile.name} on $backendName, maxNumTokens=$maxNumTokens")
            val engine =
                Engine(
                    EngineConfig(
                        modelPath = modelFile.absolutePath,
                        backend = buildBackend(),
                        maxNumTokens = maxNumTokens.takeIf { it > 0 },
                        cacheDir = context.cacheDir.absolutePath
                    )
                )
            try {
                engine.initialize()
            } catch (e: Exception) {
                runCatching { engine.close() }
                throw IOException(
                    context.getString(R.string.litertlm_error_engine_init_failed, backendName, e.message ?: e.toString()),
                    e
                )
            }
            sharedEngine = engine
            sharedEngineKey = key
            return engine
        }
    }

    private data class RoleText(val isUser: Boolean, val text: String)

    /** Gemma-style templates need strictly alternating user/model turns, so merge neighbours. */
    private fun buildTurns(
        chatHistory: List<PromptTurn>,
        preserveThinkInHistory: Boolean
    ): Pair<String, List<RoleText>> {
        val systemParts = mutableListOf<String>()
        val turns = mutableListOf<RoleText>()
        for (turn in chatHistory) {
            val raw =
                if (!preserveThinkInHistory && turn.kind == PromptTurnKind.ASSISTANT) {
                    ChatUtils.removeThinkingContent(turn.content)
                } else {
                    turn.content
                }
            val content = ChatUtils.stripOpenAiResponsesProtocolMarkup(raw)
            if (content.isBlank()) continue
            val isUser =
                when (turn.kind) {
                    PromptTurnKind.SYSTEM -> {
                        systemParts.add(content)
                        continue
                    }
                    PromptTurnKind.USER,
                    PromptTurnKind.SUMMARY,
                    PromptTurnKind.TOOL_RESULT -> true
                    PromptTurnKind.ASSISTANT,
                    PromptTurnKind.TOOL_CALL -> false
                }
            val last = turns.lastOrNull()
            if (last != null && last.isUser == isUser) {
                turns[turns.size - 1] = RoleText(isUser, last.text + "\n\n" + content)
            } else {
                turns.add(RoleText(isUser, content))
            }
        }
        // History must start with the user and the final turn is the message to send.
        while (turns.isNotEmpty() && !turns.first().isUser) {
            turns.removeAt(0)
        }
        if (turns.isEmpty() || !turns.last().isUser) {
            turns.add(RoleText(true, "Continue."))
        }
        return systemParts.joinToString("\n\n") to turns
    }

    private fun buildSamplerConfig(modelParameters: List<ModelParameter<*>>): SamplerConfig {
        fun number(id: String): Number? =
            modelParameters.firstOrNull { it.id == id && it.isEnabled }?.currentValue as? Number

        val temperature = number("temperature")?.toDouble()?.coerceAtLeast(0.0) ?: 0.8
        val topP = number("top_p")?.toDouble()?.coerceIn(0.0, 1.0) ?: 0.95
        val topK = number("top_k")?.toInt()?.takeIf { it > 0 } ?: 40
        return SamplerConfig(topK = topK, topP = topP, temperature = temperature)
    }

    override suspend fun sendMessage(
        context: Context,
        chatHistory: List<PromptTurn>,
        modelParameters: List<ModelParameter<*>>,
        enableThinking: Boolean,
        stream: Boolean,
        availableTools: List<ToolPrompt>?,
        preserveThinkInHistory: Boolean,
        onTokensUpdated: suspend (input: Long, cachedInput: Long, output: Long) -> Unit,
        onUsageReported: (suspend (com.ai.assistance.operit.data.stats.ProviderUsageSnapshot, attempt: Int) -> Unit)?,
        onNonFatalError: suspend (error: String) -> Unit,
        enableRetry: Boolean,
        recordTokenUsage: Boolean,
        onUsageFinalized: (suspend (attempt: Int?) -> Unit)?,
    ): Stream<String> = stream {
        isCancelled = false

        val engine = withContext(Dispatchers.IO) { ensureEngine() }

        val (systemPrompt, turns) = buildTurns(chatHistory, preserveThinkInHistory)
        val history = turns.dropLast(1).map { turn ->
            if (turn.isUser) Message.user(turn.text) else Message.model(turn.text)
        }
        val lastUserText = turns.last().text

        _inputTokenCount = calculateInputTokens(chatHistory, availableTools)
        _outputTokenCount = 0L
        onTokensUpdated(_inputTokenCount, 0L, 0L)

        val conversation = withContext(Dispatchers.IO) {
            engine.createConversation(
                ConversationConfig(
                    systemInstruction = systemPrompt.takeIf { it.isNotBlank() }?.let { Contents.of(it) },
                    initialMessages = history,
                    samplerConfig = buildSamplerConfig(modelParameters),
                    automaticToolCalling = false
                )
            )
        }
        activeConversation = conversation

        val usageReporter = LocalUsageReporter(SOURCE_LITERT_LM, onUsageReported)
        val finalOutput = StringBuilder()
        var success = false
        var failure: Throwable? = null
        try {
            conversation.sendMessageAsync(lastUserText)
                .flowOn(Dispatchers.IO)
                .collect { message ->
                    if (isCancelled) return@collect
                    val text = message.toString()
                    if (text.isEmpty()) return@collect
                    finalOutput.append(text)
                    // Rough streaming estimate; replaced by the KV-cache count below.
                    _outputTokenCount = (finalOutput.length / 4).toLong()
                    emit(text)
                    onTokensUpdated(_inputTokenCount, 0L, _outputTokenCount)
                }
            success = !isCancelled
        } catch (e: CancellationException) {
            if (!isCancelled) throw e
        } catch (e: Exception) {
            if (!isCancelled) {
                AppLogger.e(TAG, "LiteRT-LM generation failed", e)
                failure = e
            }
        } finally {
            activeConversation = null
            if (success) {
                runCatching { conversation.getTokenCount().toLong() }
                    .onSuccess { total ->
                        val estimatedOutput = _outputTokenCount
                        if (total > estimatedOutput) {
                            _inputTokenCount = total - estimatedOutput
                        }
                    }
            }
            runCatching { conversation.close() }
        }

        LocalGenerationEnd.end(
            cancelled = isCancelled,
            success = success,
            usageReporter = usageReporter,
            inputTokens = _inputTokenCount,
            outputTokens = _outputTokenCount,
            cancelMessage = context.getString(R.string.llama_error_request_cancelled),
            emitToolResult = {},
            failWith = {
                val message =
                    context.getString(
                        R.string.litertlm_error_inference_failed,
                        failure?.message ?: "unknown error"
                    )
                kotlin.runCatching { onNonFatalError(message) }
                throw IOException(message, failure)
            },
        )
        onUsageFinalized?.invoke(1)
        AppLogger.i(TAG, "LiteRT-LM generation done, ~$_outputTokenCount output tokens")
    }
}
