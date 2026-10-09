package com.ai.assistance.operit.api.speech

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.ai.assistance.operit.R
import com.ai.assistance.operit.util.AppLogger
import com.ai.assistance.operit.util.LocaleUtils
import java.util.Locale
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Speech recognition through Android's built-in [SpeechRecognizer].
 *
 * Prefers the on-device recognizer (Android 12+, e.g. Google's offline model on Pixel phones) and
 * falls back to the default recognition service. Continuous mode restarts listening after each
 * utterance and reports the accumulated text.
 */
class AndroidSpeechRecognizerProvider(private val context: Context) : SpeechService {

    companion object {
        private const val TAG = "AndroidSpeechProvider"
        private const val STOP_RESULT_TIMEOUT_MS = 5000L
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var recognizer: SpeechRecognizer? = null
    private var usingOnDevice = false
    private var recognizerIntent: Intent? = null

    private var continuous = false
    private var stopping = false
    private var listeningActive = false
    private var committedText = ""
    private var currentPartial = ""
    private var stopResult: CompletableDeferred<Unit>? = null
    private var currentVolume = 0f

    private val _recognitionState = MutableStateFlow(SpeechService.RecognitionState.UNINITIALIZED)
    override val currentState: SpeechService.RecognitionState
        get() = _recognitionState.value
    override val recognitionStateFlow: StateFlow<SpeechService.RecognitionState> =
        _recognitionState.asStateFlow()

    private val _recognitionResult = MutableStateFlow(SpeechService.RecognitionResult(""))
    override val recognitionResultFlow: StateFlow<SpeechService.RecognitionResult> =
        _recognitionResult.asStateFlow()

    private val _recognitionError = MutableStateFlow(SpeechService.RecognitionError(0, ""))
    override val recognitionErrorFlow: StateFlow<SpeechService.RecognitionError> =
        _recognitionError.asStateFlow()

    private val _isInitialized = MutableStateFlow(false)
    override val isInitialized: StateFlow<Boolean> = _isInitialized.asStateFlow()

    private val _volumeLevelFlow = MutableStateFlow(0f)
    override val volumeLevelFlow: StateFlow<Float> = _volumeLevelFlow.asStateFlow()

    override val isRecognizing: Boolean
        get() = currentState == SpeechService.RecognitionState.RECOGNIZING

    private val separator: String
        get() = if (LocaleUtils.usesChineseContent(context)) "" else " "

    private fun accumulatedText(): String {
        return listOf(committedText, currentPartial)
            .filter { it.isNotBlank() }
            .joinToString(separator)
    }

    private fun setError(code: Int, message: String) {
        AppLogger.w(TAG, "Recognition error $code: $message")
        _recognitionError.value = SpeechService.RecognitionError(code, message)
        _recognitionState.value = SpeechService.RecognitionState.ERROR
        _volumeLevelFlow.value = 0f
    }

    override suspend fun initialize(): Boolean {
        if (_isInitialized.value && recognizer != null) return true
        return withContext(Dispatchers.Main) {
            try {
                val onDeviceAvailable =
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
                val created =
                    when {
                        onDeviceAvailable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                        SpeechRecognizer.isRecognitionAvailable(context) ->
                            SpeechRecognizer.createSpeechRecognizer(context)
                        else -> null
                    }
                if (created == null) {
                    setError(-1, context.getString(R.string.android_stt_error_unavailable))
                    _isInitialized.value = false
                    return@withContext false
                }
                usingOnDevice = onDeviceAvailable
                created.setRecognitionListener(listener)
                recognizer = created
                AppLogger.d(TAG, "SpeechRecognizer created (onDevice=$onDeviceAvailable)")
                _isInitialized.value = true
                _recognitionState.value = SpeechService.RecognitionState.IDLE
                true
            } catch (e: Exception) {
                AppLogger.e(TAG, "SpeechRecognizer initialize failed", e)
                setError(-1, e.message ?: context.getString(R.string.android_stt_error_unavailable))
                _isInitialized.value = false
                false
            }
        }
    }

    /** Voice mode always asks for "zh-CN"; follow the app language instead unless it is Chinese. */
    private fun resolveLanguage(requested: String): String {
        val trimmed = requested.trim()
        if (trimmed.isEmpty()) return Locale.getDefault().toLanguageTag()
        if (trimmed.lowercase(Locale.ROOT).startsWith("zh") && !LocaleUtils.usesChineseContent(context)) {
            return Locale.getDefault().toLanguageTag()
        }
        return trimmed
    }

    private fun buildIntent(languageTag: String, partialResults: Boolean): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
    }

    override suspend fun startRecognition(
        languageCode: String,
        continuousMode: Boolean,
        partialResults: Boolean,
        audioSource: Int,
    ): Boolean {
        if (!initialize()) return false
        if (currentState == SpeechService.RecognitionState.RECOGNIZING ||
            currentState == SpeechService.RecognitionState.PREPARING
        ) {
            return false
        }

        return withContext(Dispatchers.Main) {
            val activeRecognizer = recognizer ?: return@withContext false
            val languageTag = resolveLanguage(languageCode)
            continuous = continuousMode
            stopping = false
            committedText = ""
            currentPartial = ""
            currentVolume = 0f
            _recognitionError.value = SpeechService.RecognitionError(0, "")
            _recognitionResult.value = SpeechService.RecognitionResult("")
            _recognitionState.value = SpeechService.RecognitionState.PREPARING

            val intent = buildIntent(languageTag, partialResults)
            recognizerIntent = intent
            try {
                activeRecognizer.startListening(intent)
                listeningActive = true
                _recognitionState.value = SpeechService.RecognitionState.RECOGNIZING
                AppLogger.d(TAG, "Listening started: language=$languageTag continuous=$continuousMode")
                true
            } catch (e: Exception) {
                AppLogger.e(TAG, "startListening failed", e)
                setError(-1, e.message ?: "startListening failed")
                false
            }
        }
    }

    override suspend fun stopRecognition(): Boolean {
        if (currentState != SpeechService.RecognitionState.RECOGNIZING) return false

        val waiter = CompletableDeferred<Unit>()
        withContext(Dispatchers.Main) {
            stopping = true
            stopResult = waiter
            _recognitionState.value = SpeechService.RecognitionState.PROCESSING
            if (listeningActive) {
                runCatching { recognizer?.stopListening() }
            } else {
                // Between utterances in continuous mode: nothing is pending.
                waiter.complete(Unit)
            }
        }

        withTimeoutOrNull(STOP_RESULT_TIMEOUT_MS) { waiter.await() }

        withContext(Dispatchers.Main) {
            stopResult = null
            finishSession()
        }
        return true
    }

    /** Publishes the accumulated text as the final result and returns to idle. */
    private fun finishSession() {
        if (currentState == SpeechService.RecognitionState.IDLE ||
            currentState == SpeechService.RecognitionState.ERROR
        ) {
            return
        }
        val text = accumulatedText()
        _recognitionResult.value = SpeechService.RecognitionResult(text = text, isFinal = true, confidence = 1f)
        _recognitionState.value = SpeechService.RecognitionState.IDLE
        _volumeLevelFlow.value = 0f
        stopping = false
    }

    override suspend fun cancelRecognition() {
        withContext(Dispatchers.Main) {
            stopping = false
            runCatching { recognizer?.cancel() }
            listeningActive = false
            stopResult?.complete(Unit)
            stopResult = null
            _volumeLevelFlow.value = 0f
            if (currentState != SpeechService.RecognitionState.UNINITIALIZED) {
                _recognitionState.value = SpeechService.RecognitionState.IDLE
            }
        }
    }

    override fun shutdown() {
        val toDestroy = recognizer
        recognizer = null
        mainHandler.post {
            runCatching { toDestroy?.cancel() }
            runCatching { toDestroy?.destroy() }
        }
        stopResult?.complete(Unit)
        stopResult = null
        _isInitialized.value = false
        _recognitionState.value = SpeechService.RecognitionState.UNINITIALIZED
        _volumeLevelFlow.value = 0f
    }

    override suspend fun getSupportedLanguages(): List<String> {
        val appLanguage = Locale.getDefault().toLanguageTag()
        return (listOf(appLanguage) +
            listOf("en-US", "en-GB", "fr-FR", "nl-NL", "de-DE", "es-ES", "it-IT", "ja-JP", "zh-CN"))
            .distinct()
    }

    override suspend fun recognize(audioData: FloatArray) {
        setError(-1, "Recognizing raw audio is not supported by the Android recognizer")
    }

    private fun restartListening() {
        val activeRecognizer = recognizer ?: return
        val intent = recognizerIntent ?: return
        mainHandler.post {
            if (currentState != SpeechService.RecognitionState.RECOGNIZING || stopping) return@post
            try {
                activeRecognizer.startListening(intent)
                listeningActive = true
            } catch (e: Exception) {
                AppLogger.e(TAG, "Restarting recognition failed", e)
                setError(-1, e.message ?: "restart failed")
            }
        }
    }

    private fun commitSegment(text: String) {
        if (text.isNotBlank()) {
            committedText = listOf(committedText, text.trim()).filter { it.isNotBlank() }.joinToString(separator)
        }
        currentPartial = ""
    }

    private val listener =
        object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}

            override fun onBeginningOfSpeech() {}

            override fun onRmsChanged(rmsdB: Float) {
                // rmsdB is roughly -2..10 dB; map it to 0..1 with light smoothing.
                val normalized = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                currentVolume = currentVolume * 0.7f + normalized * 0.3f
                _volumeLevelFlow.value = currentVolume
            }

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {}

            override fun onPartialResults(partialResults: Bundle?) {
                val text =
                    partialResults
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        .orEmpty()
                if (text.isBlank()) return
                currentPartial = text
                _recognitionResult.value =
                    SpeechService.RecognitionResult(text = accumulatedText(), isFinal = false)
            }

            override fun onResults(results: Bundle?) {
                listeningActive = false
                val text =
                    results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        .orEmpty()
                commitSegment(text.ifBlank { currentPartial })

                if (stopping) {
                    stopResult?.complete(Unit)
                    return
                }
                if (continuous && currentState == SpeechService.RecognitionState.RECOGNIZING) {
                    _recognitionResult.value =
                        SpeechService.RecognitionResult(text = accumulatedText(), isFinal = false)
                    restartListening()
                } else {
                    finishSession()
                }
            }

            override fun onError(error: Int) {
                listeningActive = false
                val silence =
                    error == SpeechRecognizer.ERROR_NO_MATCH ||
                        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                if (stopping) {
                    commitSegment(currentPartial)
                    stopResult?.complete(Unit)
                    return
                }
                if (currentState != SpeechService.RecognitionState.RECOGNIZING) {
                    // Errors after cancel()/stop are expected (e.g. ERROR_CLIENT).
                    return
                }
                if (silence) {
                    commitSegment(currentPartial)
                    if (continuous) {
                        restartListening()
                    } else {
                        finishSession()
                    }
                    return
                }
                if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && continuous) {
                    runCatching { recognizer?.cancel() }
                    mainHandler.postDelayed({ restartListening() }, 300)
                    return
                }

                val languageMissing =
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                            error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
                if (languageMissing) {
                    if (usingOnDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val intent = recognizerIntent
                        if (intent != null) {
                            runCatching { recognizer?.triggerModelDownload(intent) }
                        }
                    }
                    setError(error, context.getString(R.string.android_stt_error_language_pack))
                } else {
                    setError(error, context.getString(R.string.android_stt_error_generic, error))
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        }
}
