import axios from "../axios";
import { TranslationResult } from "../types";
import { chatCompletion, extractContent, CustomProviderConfig } from "./customProvider";

class AITranslator {
    /**
     * 共享中继令牌（免费模式走我们自己的 API 反代服务时使用，用于区分「谁都能调」与「知道令牌才能调」，
     * 并非 SiliconFlow 密钥。会进入扩展 bundle，但能挡住随手白嫖）。
     * 必须与 EdgeOne 中继 edge-functions/api/translate.js 中的 RELAY_TOKEN 一致。
     */
    private readonly RELAY_TOKEN: string = "3bfca6f691946ca6391ef342411758747dfa6f481a04bfb4";

    /** 免费模式固定地址：我们自己部署的 API 反代服务（EdgeOne 中继），强制使用，避免被旧设置覆盖。 */
    private readonly OFFICIAL_RELAY_ENDPOINT: string = "https://trans.hin.cool/api/translate";

    /**
     * 配置类错误标记。normalizeError 见到它就把后面的原文透出给用户，
     * 而不是统一压成 "AItrans translation failed"。
     */
    private static readonly CONFIG_ERROR_PREFIX: string = "LightransConfigError: ";

    /** 自定义模式默认 API 接口：直连硅基流动官方端点（注意不是我们的中继服务）。 */
    private static readonly SILICONFLOW_ENDPOINT: string = "https://api.siliconflow.cn/v1/chat/completions";

    /**
     * 翻译服务模式：
     * - "free"：硅基流动（免费），走我们自己部署的 API 反代服务，内置共享令牌，零配置、无需 API Key；
     * - "custom"：硅基流动（自定义），用户填自己的 SiliconFlow API Key，直连硅基流动官方端点；
     * - "provider"：自定义服务商，用户自填任意 OpenAI 兼容的第三方大模型接口（地址 / 密钥 / 模型）。
     */
    private serviceMode: string = "free";

    /**
     * 自定义模式下的 SiliconFlow API Key（仅 custom 模式使用，由设置页注入）。
     */
    private apiKey: string = "";

    /**
     * 当前选中的自定义服务商配置（仅 provider 模式使用，由设置页经后台注入）。
     */
    private providerConfig: CustomProviderConfig | null = null;

    /**
     * Available translation models.
     */
    private availableModels: string[] = [
        "THUDM/GLM-4-9B-0414",
        "Qwen/Qwen3.5-4B",
        "tencent/Hunyuan-MT-7B"
    ];

    /**
     * Current model to use.
     */
    private currentModel: string = "THUDM/GLM-4-9B-0414";

    /**
     * Detect language of given text.
     *
     * @param text text to detect
     *
     * @returns Promise of detected language
     */
    async detect(text: string): Promise<string> {
        // Simple heuristic to detect Chinese/English
        // Check if text contains Chinese characters
        if (/[\u4e00-\u9fa5]/.test(text)) {
            return "zh-CN";
        }
        // Check if text contains mostly English characters
        else if (/^[a-zA-Z0-9\s\p{Punctuation}]*$/u.test(text)) {
            return "en";
        }
        // For other languages, return auto
        return "auto";
    }

    /**
     * 单条翻译与批量翻译共用的底层请求方法（free / custom 两种模式）。
     *
     * @param from source language
     * @param to target language
     * @param text user 消息内容（批量为编号合并后的文本）
     * @param maxTokens 生成上限（批量时按输入长度动态估算，避免译文被截断）
     * @param batch 是否批量模式（决定 system prompt；免费模式下中继自行构造 prompt，此参数仅影响自定义模式）
     *
     * @returns Promise of translated text
     */
    private async requestTranslate(from: string, to: string, text: string, maxTokens: number, batch = false): Promise<string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        // 批量模式要求模型保留 <N> 编号标记，逐段返回译文；单条模式与原行为一致。
        const systemPrompt = batch
            ? `You are a professional translator. Translate each numbered text segment (delimited by tags like <1>, <2>) from ${from} to ${to}. Keep exactly the same tag format in your output, one translated segment per tag. Do not merge, split, add or remove any segments. Return only the tagged translations.`
            : `You are a professional translator. Translate the following text from ${from} to ${to}. Only return the translated text, no other content.`;

        if (this.serviceMode === "provider") {
            // 自定义服务商：用户自填端点 / 密钥 / 模型，走 OpenAI 兼容协议。
            const provider = this.providerConfig;
            if (!provider) {
                throw AITranslator.configError("自定义服务商模式需要先在设置里添加并选择一个服务商");
            }
            if (!provider.endpoint || !provider.endpoint.trim()) {
                throw AITranslator.configError("选中的服务商还没填接口地址，请到设置里补充");
            }

            // 这里**不能**回退到预设模型：预设是硅基流动的模型名，发给第三方服务商必然报错，
            // 与其得到一个含糊的 400，不如直接告诉用户缺模型名。
            const providerModel = (provider.model || "").trim();
            if (!providerModel) {
                throw AITranslator.configError("自定义服务商需要填写模型名称");
            }

            let data: unknown;
            try {
                data = await chatCompletion(provider, {
                    model: providerModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: text }
                    ],
                    temperature: 0.3,
                    max_tokens: maxTokens,
                    // 仅 Qwen 系列关闭思考模式（与中继服务保持一致）
                    enable_thinking: providerModel.startsWith("Qwen/") ? false : undefined
                });
            } catch (error) {
                // 5xx / 429 / 网络抖动 → 上抛，交给上层退避重试（与免费模式行为一致）
                if (AITranslator.isTransientError(error)) throw error;
                // 4xx 等属于配置问题：把状态码与上游返回原样透出。
                // 否则用户配错地址/密钥只会看到「翻译失败」，完全无法定位。
                throw AITranslator.configError(AITranslator.errorDetail(error));
            }

            const content = extractContent(data);
            if (!content) {
                throw AITranslator.configError("自定义服务商返回内容为空，请确认该接口兼容 OpenAI 的 /chat/completions 格式");
            }
            return content;
        }

        if (this.serviceMode === "custom") {
            // 硅基流动（自定义）：直连官方端点，使用用户自有 API Key 鉴权。
            if (!this.apiKey) {
                throw AITranslator.configError("自定义模式需要填写 SiliconFlow API Key");
            }

            // 发送前兜底：currentModel 为空或被污染时回退到安全模型，避免把空/非法模型名
            // 发到官方端点导致上游报错。仅 free / custom 两种硅基流动模式适用。
            const safeModel = this.getSafeModel();
            const endpoint = AITranslator.SILICONFLOW_ENDPOINT;
            headers["Authorization"] = `Bearer ${this.apiKey}`;

            // 与中继服务保持一致的请求结构，保证两种模式翻译质量一致
            const response = await axios.post(endpoint, {
                model: safeModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: text }
                ],
                temperature: 0.3,
                max_tokens: maxTokens,
                // 仅 Qwen 系列关闭思考模式（与中继服务保持一致）
                enable_thinking: this.currentModel.startsWith("Qwen/") ? false : undefined
            }, { headers });

            return (response.data?.choices?.[0]?.message?.content || "").toString().trim();
        }

        // 硅基流动（免费）：走我们自己部署的 API 反代服务，内置共享令牌，SiliconFlow Key 不进扩展。
        // 中继只放行预设模型，故 free 模式下必须回退到安全模型（getSafeModel 内含该判断）。
        const safeModel = this.getSafeModel();
        const endpoint = this.OFFICIAL_RELAY_ENDPOINT;
        headers["X-Lightrans-Token"] = this.RELAY_TOKEN;

        const response = await axios.post(endpoint, {
            text,
            from,
            to,
            model: safeModel
        }, { headers });

        // 中继返回 { translatedText }
        return (response.data?.translatedText || "").toString().trim();
    }

    /**
     * Translate text using AItrans with specified model.
     *
     * @param text text to translate
     * @param from source language
     * @param to target language
     *
     * @returns Promise of translation result
     */
    async translate(text: string, from: string, to: string): Promise<TranslationResult> {
        try {
            const translatedText = await this.requestTranslate(from, to, text, 1024);

            return {
                originalText: text,
                mainMeaning: translatedText,
                tPronunciation: "",
                sPronunciation: "",
                detailedMeanings: [],
                definitions: [],
                examples: []
            };
        } catch (error) {
            console.error("AItrans translation error:", error);
            throw AITranslator.normalizeError(error);
        }
    }

    /**
     * 批量翻译多条短文本（如导航菜单、按钮、链接文字）。
     *
     * 将多条文本用 <N> 编号分隔符合并为一次请求，大幅减少请求次数（RPM 占用），
     * 返回后按编号解析拆回；解析失败或请求失败时自动降级为逐条翻译，保证结果完整。
     *
     * 错误策略：
     * - 瞬时错误（限流 429 / 网关 5xx / 网络抖动）→ 直接上抛，调用方退避后重试整批。
     *   此时整批尚无产出，重试无损；且绝不降级为逐条——那会把 1 个请求放大成 N 个，加剧限流。
     * - 非瞬时错误（内容审核等）→ 降级逐条（单条可能因批量格式问题失败而单条能过）。
     *
     * @param texts 待翻译文本数组
     * @param from source language
     * @param to target language
     *
     * @returns Promise，与输入等长的译文数组（失败项保留原文）
     */
    async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
        if (texts.length === 0) return [];

        if (texts.length === 1) {
            try {
                const result = await this.translate(texts[0], from, to);
                return [result.mainMeaning];
            } catch (error) {
                // 瞬时错误上抛，交由调用方退避重试；其他错误保留原文
                if (AITranslator.isTransientError(error)) {
                    throw AITranslator.transientError(error);
                }
                console.error("AItrans single translation error:", error);
                return [texts[0]];
            }
        }

        const merged = texts.map((text, index) => `<${index + 1}> ${text}`).join("\n");

        let parsed: (string | null)[] | null = null;
        try {
            const maxTokens = AITranslator.estimateMaxTokens(merged.length);
            const response = await this.requestTranslate(from, to, merged, maxTokens, true);
            parsed = AITranslator.parseNumberedResult(response, texts.length);
        } catch (error) {
            if (AITranslator.isTransientError(error)) {
                throw AITranslator.transientError(error);
            }
            console.error("AItrans batch translation error:", error);
        }

        // 完全解析失败（模型未按编号格式返回）或非瞬时请求失败 → 逐条降级
        if (!parsed) {
            console.warn("AItrans batch unavailable, falling back to single translation");
            return await this.translateOneByOne(texts, from, to);
        }

        // 个别片段缺失 → 仅对缺失项逐条补翻
        const results: string[] = [];
        for (let i = 0; i < texts.length; i++) {
            if (parsed[i] !== null) {
                results.push(parsed[i] as string);
                continue;
            }
            try {
                const single = await this.translate(texts[i], from, to);
                results.push(single.mainMeaning);
            } catch (error) {
                console.error(`AItrans batch segment ${i + 1} translation error:`, error);
                results.push(texts[i]);
            }
        }
        return results;
    }

    /**
     * 逐条翻译兜底：单条失败重试一次，仍失败则保留原文。
     *
     * @param texts 待翻译文本数组
     * @param from source language
     * @param to target language
     *
     * @returns Promise，与输入等长的译文数组
     */
    private async translateOneByOne(texts: string[], from: string, to: string): Promise<string[]> {
        const results: string[] = [];
        for (const text of texts) {
            let translated = text;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const result = await this.translate(text, from, to);
                    translated = result.mainMeaning;
                    break;
                } catch (error) {
                    console.error(`AItrans fallback translation error (attempt ${attempt + 1}):`, error);
                    if (attempt === 0) {
                        await new Promise(resolve => setTimeout(resolve, 800));
                    }
                }
            }
            results.push(translated);
        }
        return results;
    }

    /**
     * 解析模型按编号格式返回的批量译文。
     *
     * @param result 模型返回的原始文本
     * @param count 批量条数
     *
     * @returns 与批量等长的数组（缺失段为 null）；一段都没匹配上时返回 null 表示整体解析失败
     */
    private static parseNumberedResult(result: string, count: number): (string | null)[] | null {
        if (!result) return null;
        const segments: (string | null)[] = new Array(count).fill(null);
        const regex = /<(\d{1,3})>\s*([\s\S]*?)(?=\n\s*<\d{1,3}>|$)/g;
        let match: RegExpExecArray | null;
        let matched = 0;
        while ((match = regex.exec(result))) {
            const index = parseInt(match[1], 10);
            const text = match[2].trim();
            if (index >= 1 && index <= count && segments[index - 1] === null && text) {
                segments[index - 1] = text;
                matched++;
            }
        }
        if (matched === 0) return null;
        return segments;
    }

    /**
     * 按输入长度估算批量请求的 max_tokens，避免合并后译文被截断。
     *
     * 译文长度通常与原文量级相当：按 1 token ≈ 2 字符保守估算，
     * 再留出系统提示与编号格式的开销；下限 1024（与单条一致），上限 4096。
     *
     * @param inputChars 合并后文本的字符数
     *
     * @returns max_tokens 值
     */
    private static estimateMaxTokens(inputChars: number): number {
        const estimated = Math.ceil(inputChars / 2) + 256;
        return Math.min(Math.max(estimated, 1024), 4096);
    }

    /**
     * 判断错误是否为限流（429）。
     *
     * @param error 捕获的错误
     *
     * @returns 是否限流
     */
    private static isRateLimitError(error: unknown): boolean {
        const err = error as { response?: { status?: number }, message?: string };
        if (err?.response?.status === 429) return true;
        const message = String(err?.message || err || "");
        return /429|rate\s*limit/i.test(message);
    }

    /**
     * 判断错误是否为瞬时错误（限流 / 网关 / 网络抖动），值得退避后重试。
     *
     * 背景：免费模式的中继会把上游各类错误（含 SiliconFlow 的限流 429 / TPM 超限）
     * 统一透传成 502，因此不能只认 429——5xx 与网络层错误同样要按瞬时错误处理，
     * 否则上层退避机制会完全失效（表现为整页 502 且无重试）。
     *
     * @param error 捕获的错误（经 axios 代理包装后为 {errorType, errorCode, errorMsg}，原始状态在 errorMsg 文本中）
     *
     * @returns 是否瞬时错误
     */
    private static isTransientError(error: unknown): boolean {
        if (AITranslator.isRateLimitError(error)) return true;
        const err = error as { errorType?: string, errorMsg?: string, message?: string };
        const text = `${err?.errorType || ""} ${err?.errorMsg || ""} ${err?.message || ""}`;
        // 5xx 网关 / 上游错误（含中继透传的 502/503/504）
        if (/status code 5\d{2}/i.test(text)) return true;
        // 网络层错误（fetch 失败、断网、DNS 等）
        if (/NET_ERR|network|ECONN|ETIMEDOUT|EAI_AGAIN|failed to fetch|timeout/i.test(text)) return true;
        return false;
    }

    /**
     * 构造带统一前缀的瞬时错误，便于上层（background / 注入端）用正则识别并退避重试。
     *
     * @param error 捕获的错误
     *
     * @returns 规范化后的 Error（消息以 "AItrans transient error" 开头）
     */
    private static transientError(error: unknown): Error {
        const err = error as { errorMsg?: string, message?: string };
        const detail = String(err?.errorMsg || err?.message || error || "");
        return new Error(`AItrans transient error: ${detail}`);
    }

    /**
     * 统一对外抛出的错误。
     *
     * 分三类，顺序不能乱：
     * 1. 配置类错误（缺地址 / 缺模型名 / 上游 4xx）→ **保留原文**。这类错误用户自己能修，
     *    笼统的「翻译失败」会让人无从下手（设置页的 friendlyTranslateError 也依赖原始消息）。
     * 2. 瞬时错误（429 / 5xx / 网络）→ 加可重试前缀，交给上层退避。
     * 3. 其余 → 兜底文案。
     *
     * @param error 捕获的错误
     *
     * @returns 规范化后的 Error
     */
    private static normalizeError(error: unknown): Error {
        const message = String((error as { message?: string })?.message || error || "");
        if (message.startsWith(AITranslator.CONFIG_ERROR_PREFIX)) {
            return new Error(message.slice(AITranslator.CONFIG_ERROR_PREFIX.length));
        }
        if (AITranslator.isTransientError(error)) {
            return AITranslator.transientError(error);
        }
        return new Error("AItrans translation failed");
    }

    /**
     * 构造配置类错误（会原样透出给用户）。
     *
     * @param message 面向用户的原因说明
     *
     * @returns 带内部标记的 Error
     */
    private static configError(message: string): Error {
        return new Error(AITranslator.CONFIG_ERROR_PREFIX + message);
    }

    /**
     * 提取错误详情文本，用于向用户透出上游原因。
     *
     * @param error 捕获的错误
     *
     * @returns 详情文本
     */
    private static errorDetail(error: unknown): string {
        const err = error as { errorMsg?: string; message?: string };
        return String(err?.errorMsg || err?.message || error || "");
    }

    /**
     * Get supported languages.
     *
     * @returns Set of supported languages
     */
    supportedLanguages(): Set<string> {
        // SiliconFlow supports many languages, but we'll return a basic set
        return new Set([
            "auto",
            "en",
            "zh-CN",
            "zh-TW",
            "fr",
            "es",
            "ru",
            "de",
            "ja",
            "ko",
            "pt",
            "it",
            "ar",
            "hi",
            "tr",
            "pl",
            "nl",
            "sv",
            "fi",
            "da",
            "no",
            "cs",
            "hu",
            "ro",
            "sk",
            "bg",
            "uk",
            "th",
            "vi",
            "id",
            "ms",
            "tl",
            "fa",
            "ur",
            "bn",
            "pa",
            "gu",
            "kn",
            "ml",
            "ta",
            "te",
            "mr",
            "ne",
            "my",
            "km",
            "lo",
            "si",
            "am",
            "sw",
            "yo",
            "zu",
            "xh",
            "af",
            "sq",
            "hy",
            "az",
            "be",
            "bs",
            "cy",
            "eo",
            "et",
            "eu",
            "gl",
            "ha",
            "haw",
            "he",
            "hr",
            "is",
            "ig",
            "iu",
            "ga",
            "ka",
            "kk",
            "ky",
            "la",
            "lv",
            "lt",
            "mk",
            "mg",
            "mi",
            "mn",
            "mt",
            "nb",
            "nn",
            "ny",
            "or",
            "ps",
            "qu",
            "sd",
            "sl",
            "so",
            "st",
            "su",
            "tg",
            "tk",
            "tt",
            "ug",
            "uz",
            "vi",
            "cy",
            "yi",
            "yo"
        ]);
    }

    /**
     * Get available models.
     *
     * @returns Array of available models
     */
    getAvailableModels(): string[] {
        return [...this.availableModels];
    }

    /**
     * Set the translation service mode (free | custom | provider).
     *
     * @param mode "free" 走我们的反代服务（内置共享令牌）；
     *             "custom" 直连硅基流动（用户自有 Key）；
     *             "provider" 使用用户自定义的第三方服务商（OpenAI 兼容）。
     */
    setServiceMode(mode: string): void {
        if (mode === "custom" || mode === "provider") {
            this.serviceMode = mode;
            return;
        }
        this.serviceMode = "free";
    }

    /**
     * Set the API Key for custom relay mode.
     *
     * @param key SiliconFlow API Key（仅 custom 模式使用）
     */
    setApiKey(key: string): void {
        this.apiKey = (key || "").trim();
    }

    /**
     * Set the active custom provider (provider 模式使用).
     *
     * 传入 null 表示「没有选中任何服务商」。注意**不会**因为 endpoint 为空就丢弃配置：
     * 空地址要留到请求时抛明确错误，而不是在这里变成 null——否则会被误判成「没配置服务商」，
     * 让上层回退到别的服务商，用户就会看到「明明选了 B 却在用 A」。
     *
     * @param config 服务商配置
     */
    setCustomProvider(config: CustomProviderConfig | null): void {
        if (!config) {
            this.providerConfig = null;
            return;
        }
        this.providerConfig = { ...config };
    }

    /**
     * Set current model to use.
     *
     * @param model model name（支持设置页自定义输入的非预设模型名）
     *
     * @returns boolean whether the model was set successfully
     */
    setCurrentModel(model: string): boolean {
        if (model && typeof model === "string") {
            this.currentModel = model.trim();
            return true;
        }
        return false;
    }

    /**
     * Get current model.
     *
     * @returns current model name
     */
    getCurrentModel(): string {
        return this.currentModel;
    }

    /**
     * 计算发送翻译请求时实际使用的「安全模型名」。
     *
     * 兜底逻辑（根因修复）：currentModel 可能因为以下情况被污染为空值或非法模型名——
     * - 自定义模式勾选了「自定义模型」但模型名未填写；
     * - 切换服务模式 / 模型时重算失败（setCurrentModel 对空值静默 no-op）；
     * - 各路径间 currentModel 与 AIModel 失同步。
     * 一旦把空/非法模型名发给中继（免费模式）或官方端点（自定义模式），上游报错会透传成 502。
     *
     * 规则：
     * - currentModel 为空 → 回退到预设列表首个模型；
     * - 免费模式下 currentModel 不在预设列表（中继仅放行这些）→ 同样回退到预设列表首个模型；
     * - 其余情况原样返回。
     *
     * @returns 保证非空、且在免费模式下一定被中继接受的模型名
     */
    private getSafeModel(): string {
        const current = (this.currentModel || "").trim();
        if (!current) {
            return this.availableModels[0];
        }
        if (this.serviceMode === "free" && !this.availableModels.includes(current)) {
            return this.availableModels[0];
        }
        return current;
    }
}

export default AITranslator;
