/* METADATA
{
  "name": "nanobanana_draw",

  "display_name": {
      "zh": "Nanobanana 绘图",
      "en": "Nanobanana Draw"
  },
  "description": {
    "zh": "使用 Nano Banana API (基于Grsai的api服务/https://grsai.com/) 根据提示词画图，支持文生图和图生图（可传入参考图片URL或本地图片路径；本地图片会先上传到图床以获得公网URL），将图片保存到本地 /sdcard/Download/Operit/plugins/draw/nanobanana_draw/draws/ 目录，并返回 Markdown 图片提示。",
    "en": "Generate images using the Nano Banana API (via Grsai service / https://grsai.com/). Supports text-to-image and image-to-image (you can provide reference image URLs or local image paths; local images will be uploaded first to get public URLs). Saves images to /sdcard/Download/Operit/plugins/draw/nanobanana_draw/draws/ and returns a Markdown image reference."
  },
  "env": [
    "NANOBANANA_API_KEY",
    "NANOBANANA_API_BASE_URL",
    "BEEIMG_API_KEY"
  ],
  "category": "Draw",
  "tools": [
    {
      "name": "draw_image",
      "description": {
        "zh": "根据提示词调用 Nano Banana API 生成图片（支持文生图和图生图），保存到本地并返回 Markdown 图片提示。",
        "en": "Generate an image via the Nano Banana API using a prompt (supports text-to-image and image-to-image), save locally, and return a Markdown image reference."
      },
      "parameters": [
        { "name": "prompt", "description": { "zh": "绘图提示词（英文或中文皆可）", "en": "Image prompt (Chinese or English)" }, "type": "string", "required": true },
        { "name": "model", "description": { "zh": "Nano Banana 模型名称（优先级最高）。可填 nano-banana-pro（约1800积分）或 nano-banana（约400积分）", "en": "Nano Banana model name (highest priority). e.g. nano-banana-pro (~1800 credits) or nano-banana (~400 credits)." }, "type": "string", "required": false },
        { "name": "model_variant", "description": { "zh": "模型档位（二选一，可选）：pro（约1800积分）或 nano（约400积分）。未传时默认 pro", "en": "Model tier (optional): pro (~1800 credits) or nano (~400 credits). Defaults to pro." }, "type": "string", "required": false },
        { "name": "aspect_ratio", "description": { "zh": "输出图像比例，如 '1:1', '16:9', 'auto' 等，可选", "en": "Output aspect ratio, e.g. '1:1', '16:9', 'auto' (optional)" }, "type": "string", "required": false },
        { "name": "image_size", "description": { "zh": "输出图像大小，仅 nano-banana-pro 支持，如 '1K', '2K', '4K'，可选", "en": "Output image size (only supported by nano-banana-pro), e.g. '1K', '2K', '4K' (optional)" }, "type": "string", "required": false },
        { "name": "image_urls", "description": { "zh": "参考图URL数组（图生图），支持格式：字符串数组['https://...'] 或 JSON字符串'[\"https://...\"]' 或逗号分隔'url1,url2'，可选", "en": "Reference image URL list for img2img. Accepts: string array ['https://...'], or JSON string '[\"https://...\"]', or comma-separated 'url1,url2' (optional)." }, "type": "array", "required": false },
        { "name": "image_paths", "description": { "zh": "参考图本地路径数组（图生图，会先上传图床再进行生成），支持格式：字符串数组['/sdcard/...'] 或 JSON字符串 或 逗号分隔，可选", "en": "Reference local image path list for img2img (will be uploaded first). Accepts: string array ['/sdcard/...'], or JSON string, or comma-separated list (optional)." }, "type": "array", "required": false },
        { "name": "file_name", "description": { "zh": "自定义保存到本地的文件名（不含路径和扩展名）", "en": "Custom output file name (without path or extension)" }, "type": "string", "required": false },
        { "name": "poll_interval_ms", "description": { "zh": "轮询间隔（毫秒），默认 5000", "en": "Polling interval (milliseconds), default 5000" }, "type": "number", "required": false },
        { "name": "max_wait_time_ms", "description": { "zh": "最长等待时间（毫秒）。默认 10 分钟", "en": "Max wait time (milliseconds). Default 10 minutes." }, "type": "number", "required": false }
      ]
    }
  ]
}*/

const nanobananaDraw = (function () {
    const HTTP_TIMEOUT_MS = 600000;
    const client = OkHttp.newBuilder()
        .connectTimeout(HTTP_TIMEOUT_MS)
        .readTimeout(HTTP_TIMEOUT_MS)
        .writeTimeout(HTTP_TIMEOUT_MS)
        .build();

    const BEEIMG_UPLOAD_ENDPOINT = "https://beeimg.com/api/upload/file/json/";

    // API配置
    const DEFAULT_API_BASE_URL = "https://grsai.dakka.com.cn";
    const DRAW_API_PATH = "v1/draw/nano-banana";
    const RESULT_API_PATH = "v1/draw/result";
    const MODEL_PRO = "nano-banana-pro";
    const MODEL_NANO = "nano-banana";
    const DEFAULT_MODEL = MODEL_PRO;
    // Android 实际路径为 /sdcard/Download，对应系统中文名"下载"
    const DRAW_ROOT_DIR = getPluginConfigDir("draw");
    const STORAGE_DIR = `${DRAW_ROOT_DIR}/nanobanana_draw`;
    const DRAWS_DIR = `${STORAGE_DIR}/draws`;

    // 轮询配置
    const POLL_INTERVAL = 5000;      // 每5秒查询一次
    const MAX_WAIT_TIME = 600000;    // 最多等待10分钟

    function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }

    function getErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        return String(error);
    }

    function getErrorStack(error: unknown): string | undefined {
        if (error instanceof Error) return error.stack;
        return undefined;
    }

    function resolveModel(model?: string, modelVariant?: string): string {
        if (model && model.trim().length > 0) {
            return model.trim();
        }

        if (!modelVariant || modelVariant.trim().length === 0) {
            return DEFAULT_MODEL;
        }

        const normalizedVariant = modelVariant.trim().toLowerCase();
        if (normalizedVariant === "pro") {
            return MODEL_PRO;
        }
        if (normalizedVariant === "nano") {
            return MODEL_NANO;
        }

        throw new Error("Parameter model_variant only supports 'pro' or 'nano'.");
    }

    function normalizePositiveInt(value: unknown, fallback: number): number {
        if (value === undefined || value === null) {
            return fallback;
        }
        const n = typeof value === "number" ? value : parseInt(String(value), 10);
        if (!Number.isFinite(n) || n <= 0) {
            return fallback;
        }
        return Math.floor(n);
    }

    function getApiKey(): string {
        const apiKey = getEnv("NANOBANANA_API_KEY");
        if (!apiKey) {
            throw new Error("NANOBANANA_API_KEY is not configured. Set your Nano Banana API key in the environment variables.");
        }
        return apiKey;
    }

    function getBeeimgApiKey(): string {
        return getEnv("BEEIMG_API_KEY") || "";
    }

    function joinUrl(baseUrl: string, path: string): string {
        const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
        const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
        return `${normalizedBase}${normalizedPath}`;
    }

    function getApiBaseUrl(): string {
        const fromEnv = (getEnv("NANOBANANA_API_BASE_URL") || "").trim();
        if (fromEnv) return fromEnv;
        return DEFAULT_API_BASE_URL;
    }

    function getDrawEndpoint(baseUrl: string): string {
        const trimmed = baseUrl.trim();
        if (!trimmed) return joinUrl(DEFAULT_API_BASE_URL, DRAW_API_PATH);
        if (trimmed.includes("/v1/draw/nano-banana")) return trimmed;
        if (trimmed.endsWith("/v1")) return joinUrl(trimmed, "draw/nano-banana");
        if (trimmed.endsWith("/v1/")) return joinUrl(trimmed, "draw/nano-banana");
        return joinUrl(trimmed, DRAW_API_PATH);
    }

    function getResultEndpoint(baseUrl: string): string {
        const trimmed = baseUrl.trim();
        if (!trimmed) return joinUrl(DEFAULT_API_BASE_URL, RESULT_API_PATH);
        if (trimmed.includes("/v1/draw/result")) return trimmed;
        if (trimmed.includes("/v1/draw/nano-banana")) {
            return trimmed.replace("/v1/draw/nano-banana", "/v1/draw/result");
        }
        if (trimmed.endsWith("/v1")) return joinUrl(trimmed, "draw/result");
        if (trimmed.endsWith("/v1/")) return joinUrl(trimmed, "draw/result");
        return joinUrl(trimmed, RESULT_API_PATH);
    }

    function guessMimeTypeFromPath(filePath: string): string {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        return "application/octet-stream";
    }

    function safeJsonParseLoose(text: string): unknown {
        const trimmed = (text || "").trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed) as unknown;
        } catch (e) {
            const start = trimmed.indexOf("{");
            const end = trimmed.lastIndexOf("}");
            if (start !== -1 && end !== -1 && end > start) {
                return JSON.parse(trimmed.substring(start, end + 1)) as unknown;
            }
            throw e;
        }
    }

    function isApiSuccessResponse(parsed: Record<string, unknown>): boolean {
        const code = parsed["code"];
        return code === undefined || code === null || code === 0 || code === "0";
    }

    function extractTaskPayload(parsed: unknown): Record<string, unknown> | null {
        if (!isRecord(parsed)) {
            return null;
        }
        if (isRecord(parsed["data"])) {
            return parsed["data"] as Record<string, unknown>;
        }
        return parsed;
    }

    function extractMessage(parsed: Record<string, unknown>, fallback: string): string {
        const payload = extractTaskPayload(parsed);
        const candidates: unknown[] = [
            parsed["msg"],
            parsed["message"],
            payload ? payload["failure_reason"] : undefined,
            payload ? payload["error"] : undefined,
            payload ? payload["msg"] : undefined,
            payload ? payload["message"] : undefined
        ];

        for (const candidate of candidates) {
            if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim().length > 0) {
                return String(candidate).trim();
            }
        }

        return fallback;
    }

    function normalizeStatus(status: unknown): string {
        return typeof status === "string" ? status.trim().toLowerCase() : "";
    }

    function normalizeProgress(progress: unknown): number {
        const normalized = typeof progress === "number" ? progress : Number(String(progress));
        return Number.isFinite(normalized) ? normalized : 0;
    }

    function isSuccessStatus(status: string): boolean {
        return status === "succeeded" || status === "success" || status === "completed" || status === "done";
    }

    function isFailureStatus(status: string): boolean {
        return status === "failed" || status === "error" || status === "canceled" || status === "cancelled";
    }

    function extractImageUrlFromPayload(payload: Record<string, unknown>): string {
        const directCandidates: unknown[] = [
            payload["url"],
            payload["image_url"],
            payload["imageUrl"],
            payload["file_url"],
            payload["fileUrl"],
            payload["result_url"]
        ];

        for (const candidate of directCandidates) {
            if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim().length > 0) {
                return String(candidate).trim();
            }
        }

        const results = payload["results"];
        if (!Array.isArray(results) || results.length === 0) {
            return "";
        }

        const first = results[0];
        if (isRecord(first)) {
            const nestedCandidates: unknown[] = [
                first["url"],
                first["image_url"],
                first["imageUrl"],
                first["file_url"],
                first["fileUrl"],
                first["result_url"]
            ];
            for (const candidate of nestedCandidates) {
                if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim().length > 0) {
                    return String(candidate).trim();
                }
            }
        } else if ((typeof first === "string" || typeof first === "number") && String(first).trim().length > 0) {
            return String(first).trim();
        }

        return "";
    }

    async function uploadImageToBeeimg(filePath: string): Promise<string> {
        const exists = await Tools.Files.exists(filePath);
        if (!exists.exists) {
            throw new Error(`Reference image file does not exist: ${filePath}`);
        }

        const apiKey = getBeeimgApiKey();
        if (!apiKey) {
            throw new Error("Using image_paths requires BEEIMG_API_KEY (used to upload local images to an image host to get a public URL).");
        }

        const resp = await Tools.Net.uploadFile({
            url: BEEIMG_UPLOAD_ENDPOINT,
            method: "POST",
            form_data: {
                apikey: apiKey
            },
            files: [
                {
                    field_name: "file",
                    file_path: filePath,
                    content_type: guessMimeTypeFromPath(filePath)
                }
            ]
        });

        if (resp.statusCode < 200 || resp.statusCode >= 300) {
            throw new Error(`BeeIMG upload failed: HTTP ${resp.statusCode} - ${resp.content}`);
        }

        let parsed: unknown;
        try {
            parsed = safeJsonParseLoose(resp.content);
        } catch (e: unknown) {
            throw new Error(`Failed to parse BeeIMG upload response: ${getErrorMessage(e)}`);
        }

        const files = isRecord(parsed) && isRecord(parsed["files"]) ? (parsed["files"] as Record<string, unknown>) : null;
        const ok = !!files && (files["status"] === "Success" || files["code"] === "200" || files["code"] === 200);
        const url = files ? files["url"] : undefined;
        if (!ok || (typeof url !== "string" && typeof url !== "number") || String(url).trim().length === 0) {
            throw new Error(`BeeIMG upload failed: ${resp.content}`);
        }
        return String(url);
    }

    function sanitizeFileName(name: string): string {
        const safe = name.replace(/[\\/:*?"<>|]/g, "_").trim();
        if (!safe) {
            return `nano_draw_${Date.now()}`;
        }
        return safe.substring(0, 80);
    }

    function buildFileName(prompt: string, customName?: string | null): string {
        if (customName && customName.trim().length > 0) {
            return sanitizeFileName(customName);
        }
        const shortPrompt = prompt.length > 40 ? `${prompt.substring(0, 40)}...` : prompt;
        const base = sanitizeFileName(shortPrompt || "image");
        const timestamp = Date.now();
        return `${base}_${timestamp}`;
    }

    async function ensureDirectories(): Promise<void> {
        const dirs = [DRAW_ROOT_DIR, STORAGE_DIR, DRAWS_DIR];
        for (const dir of dirs) {
            try {
                const result = await Tools.Files.mkdir(dir);
                if (!result.successful) {
                    console.warn(`创建目录失败(可能已存在): ${dir} -> ${result.details}`);
                }
            } catch (e: unknown) {
                console.warn(`创建目录异常: ${dir} -> ${getErrorMessage(e)}`);
            }
        }
    }

    async function callNanobananaApi(params: {
        prompt: string;
        model: string;
        aspect_ratio?: string;
        image_size?: string;
        image_urls?: string[];
        poll_interval_ms?: number;
        max_wait_time_ms?: number;
    }): Promise<string> {
        const apiKey = getApiKey();
        const endpoint = getDrawEndpoint(getApiBaseUrl());

        // 构建请求体 - 使用异步模式（webHook: "-1"）
        const body: Record<string, unknown> = {
            model: params.model,
            prompt: params.prompt,
            webHook: "-1",  // 关键：立即返回任务ID
            shutProgress: false
        };

        // 添加可选参数
        if (params.aspect_ratio && params.aspect_ratio.trim().length > 0) {
            body.aspectRatio = params.aspect_ratio.trim();
        }

        if (params.image_size && params.image_size.trim().length > 0) {
            body.imageSize = params.image_size.trim();
        }

        // 图生图：添加参考图URL数组
        // 支持格式：['https://example.com/1.jpg', 'https://example.com/2.jpg']
        // 或 JSON字符串："[\"https://...\"]"
        // 或 逗号分隔："url1,url2"
        if (params.image_urls && Array.isArray(params.image_urls) && params.image_urls.length > 0) {
            body.urls = params.image_urls.filter(url => url && url.trim().length > 0);
        }

        const headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        };

        const request = client
            .newRequest()
            .url(endpoint)
            .method("POST")
            .headers(headers)
            .body(JSON.stringify(body), "json");

        console.log("步骤1/2: 提交绘图任务...");
        const response = await request.build().execute();

        if (!response.isSuccessful()) {
            throw new Error(`Nano Banana API call failed: ${response.statusCode} - ${response.content}`);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(response.content) as unknown;
        } catch (e: unknown) {
            throw new Error(`Failed to parse Nano Banana response: ${getErrorMessage(e)}`);
        }

        if (!isRecord(parsed)) {
            throw new Error("The API response is not a valid object; check that the parameters are correct. Response: " + response.content);
        }
        if (!isApiSuccessResponse(parsed)) {
            throw new Error(`Nano Banana API returned an error: ${extractMessage(parsed, response.content)}`);
        }

        const payload = extractTaskPayload(parsed);
        if (!payload || typeof payload["id"] !== "string") {
            throw new Error("No task ID found in the API response; check that the parameters are correct. Response: " + JSON.stringify(parsed));
        }

        const taskId: string = payload["id"] as string;
        console.log(`任务提交成功! ID: ${taskId}`);
        const pollIntervalMs = params.poll_interval_ms ?? POLL_INTERVAL;
        const maxWaitTimeMs = params.max_wait_time_ms ?? MAX_WAIT_TIME;
        console.log(`步骤2/2: 等待任务完成（轮询中，每${pollIntervalMs / 1000}秒查询一次，最长等待${Math.ceil(maxWaitTimeMs / 60000)}分钟）...`);

        return taskId;
    }

    async function pollForResult(taskId: string, options: { poll_interval_ms?: number; max_wait_time_ms?: number } = {}): Promise<string> {
        const apiKey = getApiKey();
        const endpoint = getResultEndpoint(getApiBaseUrl());
        const pollIntervalMs = normalizePositiveInt(options.poll_interval_ms, POLL_INTERVAL);
        const maxWaitTimeMs = normalizePositiveInt(options.max_wait_time_ms, MAX_WAIT_TIME);
        const startTime = Date.now();
        let attempt = 0;

        const doSleep = async (ms: number): Promise<void> => {
            await Tools.System.sleep(ms);
        };

        while (Date.now() - startTime < maxWaitTimeMs) {
            attempt++;
            console.log(`第${attempt}次查询任务状态...`);

            try {
                const request = client
                    .newRequest()
                    .url(endpoint)
                    .method("POST")
                    .headers({
                        "accept": "application/json",
                        "content-type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    })
                    .body(JSON.stringify({ id: taskId }), "json");

                const response = await request.build().execute();

                if (!response.isSuccessful()) {
                    console.warn(`⚠️ 查询请求未成功 (HTTP ${response.statusCode}): ${response.content}，将重试...`);
                    await doSleep(pollIntervalMs);
                    continue;
                }

                let parsed: unknown;
                try {
                    parsed = JSON.parse(response.content) as unknown;
                } catch (_error: unknown) {
                    console.warn("⚠️ 解析结果响应失败，将重试");
                    await doSleep(pollIntervalMs);
                    continue;
                }

                if (!isRecord(parsed)) {
                    console.warn(`查询响应异常: ${JSON.stringify(parsed)}`);
                    await doSleep(pollIntervalMs);
                    continue;
                }

                if (parsed["code"] === -22 || parsed["code"] === "-22") {
                    console.log("任务排队/处理中... (等待服务器生成)");
                    await doSleep(pollIntervalMs);
                    continue;
                }

                if (!isApiSuccessResponse(parsed)) {
                    console.warn(`⚠️ API 返回异常状态，将重试: ${JSON.stringify(parsed)}`);
                    await doSleep(pollIntervalMs);
                    continue;
                }

                const data = extractTaskPayload(parsed);
                if (!data) {
                    console.warn(`查询响应异常 (无有效数据): ${JSON.stringify(parsed)}`);
                    await doSleep(pollIntervalMs);
                    continue;
                }

                const progress = normalizeProgress(data["progress"]);
                const status = normalizeStatus(data["status"]);
                const imageUrl = extractImageUrlFromPayload(data);

                console.log(`当前进度: ${progress}% | 状态: ${status || "unknown"}`);

                if (isSuccessStatus(status) || (progress >= 100 && imageUrl.length > 0)) {
                    console.log("✅ 任务完成!");
                    if (imageUrl.length === 0) {
                        throw new Error("Task completed but no image URL was found in the response: " + JSON.stringify(data));
                    }
                    return imageUrl;
                }
                if (isFailureStatus(status)) {
                    throw new Error(`Task failed: ${JSON.stringify(data)}`);
                }
                if ((status === "running" || status === "processing") && progress > 0) {
                    console.log(`生成中... 进度: ${progress}%`);
                }
            } catch (error: unknown) {
                console.log(`⚠️ 第${attempt}次查询发生不可预知的异常: ${getErrorMessage(error)}，程序将自动进行下一次尝试...`);
            }

            await doSleep(pollIntervalMs);
        }

        throw new Error(`Task timed out: not finished after waiting more than ${Math.ceil(maxWaitTimeMs / 60000)} minute(s)`);
    }

    function guessExtensionFromUrl(url: string): string {
        const match = url.match(/\.(png|jpg|jpeg|webp|gif)(?:\?|#|$)/i);
        if (match && match[1]) {
            return match[1].toLowerCase();
        }
        return "png";
    }

    interface DrawImageParams {
        prompt: string;
        model?: string;
        model_variant?: string;
        aspect_ratio?: string;
        image_size?: string;
        image_urls?: string[] | string;
        image_paths?: string[] | string;
        file_name?: string;
        poll_interval_ms?: number | string;
        max_wait_time_ms?: number | string;
    }

    interface DrawImageResult {
        file_path: string;
        file_uri: string;
        markdown: string;
        prompt: string;
        model: string;
        aspect_ratio?: string;
        image_size?: string;
        image_urls?: string[] | string;
        image_paths?: string[] | string;
        hint: string;
    }

    async function draw_image(params: DrawImageParams): Promise<DrawImageResult> {
        if (!params || !params.prompt || params.prompt.trim().length === 0) {
            throw new Error("Parameter prompt must not be empty.");
        }

        const prompt = params.prompt.trim();
        const resolvedModel = resolveModel(params.model, params.model_variant);

        if (params.image_size && params.image_size.trim().length > 0 && resolvedModel !== MODEL_PRO) {
            throw new Error("Parameter image_size is only supported by the pro model (model_variant='pro' or model='nano-banana-pro').");
        }

        const pollIntervalMs = normalizePositiveInt(params.poll_interval_ms, POLL_INTERVAL);
        const normalizedImageSize = params.image_size ? params.image_size.trim().toUpperCase() : "";
        const defaultMaxWaitTimeMs = normalizedImageSize === "4K" ? 600000 : MAX_WAIT_TIME;
        const maxWaitTimeMs = normalizePositiveInt(params.max_wait_time_ms, defaultMaxWaitTimeMs);

        // 添加辅助函数来解析URL数组
        function parseImageUrls(image_urls: string[] | string): string[] {
            // 如果已经是数组，直接过滤空值返回
            if (Array.isArray(image_urls)) {
                return image_urls.filter(url => url && url.trim().length > 0);
            }

            // 如果是字符串，尝试解析
            if (typeof image_urls === "string") {
                // 方法一：尝试JSON解析
                try {
                    const parsed: unknown = JSON.parse(image_urls) as unknown;
                    if (Array.isArray(parsed)) {
                        return parsed.filter((url) => typeof url === "string" && url.trim().length > 0);
                    }
                } catch (e) {
                    // 解析失败继续方法二
                }

                // 方法二：按逗号分割（支持 "url1,url2" 格式）
                const splitUrls = image_urls.split(",")
                    .map(url => url.trim())
                    .filter(url => url.length > 0);
                if (splitUrls.length > 0) {
                    return splitUrls;
                }
            }

            return [];
        }

        function parseImagePaths(image_paths: string[] | string): string[] {
            if (Array.isArray(image_paths)) {
                return image_paths.filter(p => p && String(p).trim().length > 0).map(p => String(p).trim());
            }
            if (typeof image_paths === "string") {
                try {
                    const parsed: unknown = JSON.parse(image_paths) as unknown;
                    if (Array.isArray(parsed)) {
                        return parsed.filter((p) => p && String(p).trim().length > 0).map((p) => String(p).trim());
                    }
                } catch (e) {
                    // ignore
                }

                const splitPaths = image_paths.split(",")
                    .map(p => p.trim())
                    .filter(p => p.length > 0);
                if (splitPaths.length > 0) {
                    return splitPaths;
                }
            }
            return [];
        }

        // 替换原有的验证逻辑
        let imageUrlsArray: string[] = [];
        if (params.image_urls) {
            imageUrlsArray = parseImageUrls(params.image_urls);
            if (imageUrlsArray.length === 0) {
                throw new Error("Parameter image_urls must be an array of valid URLs.");
            }
        }

        let imagePathsArray: string[] = [];
        if (params.image_paths) {
            imagePathsArray = parseImagePaths(params.image_paths);
            if (imagePathsArray.length === 0) {
                throw new Error("Parameter image_paths must be an array of valid local paths.");
            }
        }

        if (imagePathsArray.length > 0) {
            console.log(`检测到 ${imagePathsArray.length} 张本地参考图，开始上传以获得公网URL...`);
            for (const p of imagePathsArray) {
                const url = await uploadImageToBeeimg(p);
                imageUrlsArray.push(url);
            }
            console.log("本地参考图上传完成。");
        }

        await ensureDirectories();

        // 步骤1: 提交任务并获取任务ID
        const taskId = await callNanobananaApi({
            prompt,
            model: resolvedModel,
            aspect_ratio: params.aspect_ratio,
            image_size: params.image_size,
            image_urls: imageUrlsArray,
            poll_interval_ms: pollIntervalMs,
            max_wait_time_ms: maxWaitTimeMs
        });

        // 步骤2: 轮询等待任务完成
        const imageUrl = await pollForResult(taskId, { poll_interval_ms: pollIntervalMs, max_wait_time_ms: maxWaitTimeMs });

        const ext = guessExtensionFromUrl(imageUrl);
        const baseName = buildFileName(prompt, params.file_name ?? null);
        const filePath = `${DRAWS_DIR}/${baseName}.${ext}`;

        const downloadResult = await Tools.Files.download(imageUrl, filePath);
        if (!downloadResult.successful) {
            throw new Error(`Failed to download image: ${downloadResult.details}`);
        }

        const fileUri = `file://${filePath}`;
        const markdown = `![AI-generated image](${fileUri})`;

        const hintLines: string[] = [];
        hintLines.push(`Image generated and saved locally in ${DRAWS_DIR}.`);
        hintLines.push(`Local path: ${filePath}`);
        hintLines.push("");
        hintLines.push("In later replies, output the following line of Markdown directly to show this image:");
        hintLines.push("");
        hintLines.push(markdown);

        return {
            file_path: filePath,
            file_uri: fileUri,
            markdown,
            prompt,
            model: resolvedModel,
            aspect_ratio: params.aspect_ratio,
            image_size: params.image_size,
            image_urls: params.image_urls,
            image_paths: params.image_paths,
            hint: hintLines.join("\n")
        };
    }

    async function draw_image_wrapper(params: DrawImageParams) {
        try {
            const result = await draw_image(params);
            complete({
                success: true,
                message: `Image generated, saved to ${DRAWS_DIR}, and a Markdown image hint was returned.`,
                data: result
            });
        } catch (error: unknown) {
            console.error("draw_image 执行失败:", error);
            complete({
                success: false,
                message: `Image generation failed: ${getErrorMessage(error)}`,
                error_stack: getErrorStack(error)
            });
        }
    }

    return {
        draw_image: draw_image_wrapper
    };
})();

exports.draw_image = nanobananaDraw.draw_image;
