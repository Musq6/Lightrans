/**
 * 自定义第三方大模型服务商（OpenAI 兼容协议）。
 *
 * 设计要点：
 * - 只用原生 fetch，**不经过 axios 代理**。axios 代理（src/axios.ts）会把所有失败统一包装成
 *   `{errorType:"NET_ERR", errorMsg}`，HTTP 状态码与响应体全部丢失；而「自定义服务商」最需要的
 *   恰恰是这两样——用户配错地址/密钥时要能看到 401 与上游返回的原因。这里刻意绕开它。
 * - 错误消息统一格式化为 `Request failed with status code <N>: <body>`，这样 AITranslator 里既有的
 *   `isTransientError()` 正则（识别 `status code 5xx`）无需改动即可继续工作，429/网络错误同样命中。
 * - 该模块同时服务三处：实际翻译、设置页「测试连接」、「拉取模型列表」。三处共用同一套
 *   地址归一化与鉴权逻辑，保证「测试通过」与「实际能翻」不会出现口径不一致。
 */

/**
 * 一个自定义服务商的完整配置（存于 chrome.storage.sync 的 CustomProviders 数组项）。
 */
export interface CustomProviderConfig {
    /** 稳定标识，用于记住当前选中项；由设置页生成 */
    id?: string;
    /** 展示名称 */
    name?: string;
    /** 对话补全接口地址。允许只填到域名或 /v1，会自动补全路径 */
    endpoint: string;
    /** API Key，为空时不发送 Authorization 头 */
    apiKey?: string;
    /** 模型名称 */
    model?: string;
    /** 额外请求头，`Key: Value` 每行一个（用于 x-api-key 等非标准鉴权） */
    headers?: string;
}

/**
 * 测试连接的结果。
 */
export interface ProviderTestResult {
    ok: boolean;
    /** 面向用户的一句话结论（成功或失败原因） */
    message: string;
    /** 成功时返回的样例译文 */
    sample?: string;
}

/** 对话补全路径，用于判断用户填的地址是否已含该路径 */
const CHAT_COMPLETIONS_PATH = "/chat/completions";

/**
 * 把用户填写的接口地址归一化为可直接 POST 的对话补全地址。
 *
 * 容错规则（按顺序）：
 * 1. 裸域名自动补 `https://`（本地调试填 `localhost:11434` 时按 http 处理）；
 * 2. 去掉结尾多余斜杠；
 * 3. 已含 `/chat/completions` → 原样使用（用户可能填了非标准路径）；
 * 4. 只有域名（路径为空或 `/`）→ 补 `/v1/chat/completions`，因为主流服务商都在 /v1 下；
 * 5. 其余情况（如 `/api/v3`、`/compatible-mode/v1`）→ 保留已有路径，只追加 `/chat/completions`。
 *
 * @param endpoint 用户填写的地址
 *
 * @returns 归一化后的完整对话补全地址
 *
 * @throws 地址为空时抛出
 */
export function normalizeEndpoint(endpoint: string): string {
    let raw = (endpoint || "").trim();
    if (!raw) {
        throw new Error("请填写接口地址");
    }

    if (!/^https?:\/\//i.test(raw)) {
        // 本地服务（Ollama / LM Studio / vLLM）通常没有证书，按 http 处理更可用
        const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(raw);
        raw = (isLocal ? "http://" : "https://") + raw;
    }

    raw = raw.replace(/\/+$/, "");

    if (/\/chat\/completions$/i.test(raw)) {
        return raw;
    }

    let pathname: string;
    try {
        pathname = new URL(raw).pathname;
    } catch (e) {
        throw new Error("接口地址格式不正确，请检查是否含有非法字符");
    }

    if (pathname === "" || pathname === "/") {
        return raw + "/v1" + CHAT_COMPLETIONS_PATH;
    }

    return raw + CHAT_COMPLETIONS_PATH;
}

/**
 * 由对话补全地址推导出模型列表地址（OpenAI 兼容的 `/v1/models`）。
 *
 * @param endpoint 对话补全地址（未归一化也可）
 *
 * @returns 模型列表地址
 */
export function deriveModelsEndpoint(endpoint: string): string {
    return normalizeEndpoint(endpoint).replace(/\/chat\/completions$/i, "/models");
}

/**
 * 解析用户填写的额外请求头。
 *
 * 格式：每行 `Key: Value`；`#` 开头的行与空行忽略；无冒号或 Key 为空的行忽略。
 * Value 中允许含冒号（按第一个冒号切分），故 `Authorization: Bearer a:b` 能正确解析。
 *
 * @param raw 多行文本
 *
 * @returns 请求头对象
 */
export function parseExtraHeaders(raw?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!raw) return headers;

    for (const line of String(raw).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separator = trimmed.indexOf(":");
        if (separator <= 0) continue;

        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (key && value) {
            headers[key] = value;
        }
    }

    return headers;
}

/**
 * 构造最终请求头：`Content-Type` → 自动 `Authorization` → 用户自定义头（后者优先）。
 *
 * 若用户在额外请求头里自己写了 `Authorization`（或 `api-key` 等其他鉴权头），
 * 就不再注入 `Bearer <apiKey>`，避免两个鉴权头互相覆盖导致 401。
 *
 * @param config 服务商配置
 *
 * @returns 请求头对象
 */
export function buildHeaders(config: CustomProviderConfig): Record<string, string> {
    const extra = parseExtraHeaders(config && config.headers);
    const hasAuthorization = Object.keys(extra).some(key => key.toLowerCase() === "authorization");

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...extra,
    };

    const apiKey = ((config && config.apiKey) || "").trim();
    if (apiKey && !hasAuthorization) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    return headers;
}

/**
 * 截断响应体用于错误提示，避免把整页 HTML 塞进消息里。
 *
 * @param text 原始响应文本
 * @param limit 最大长度
 *
 * @returns 折叠空白并截断后的片段
 */
function snippet(text: string, limit = 300): string {
    const collapsed = String(text || "").replace(/\s+/g, " ").trim();
    return collapsed.length > limit ? collapsed.slice(0, limit) + "…" : collapsed;
}

/**
 * 发送请求并解析 JSON 响应。
 *
 * 失败时抛出的消息统一为 `Request failed with status code <N>: <body>`，
 * 以便上层既有的瞬时错误识别逻辑（5xx / 429）直接复用。
 *
 * @param url 完整地址
 * @param init fetch 参数
 *
 * @returns 解析后的响应体（非 JSON 时返回 `{ raw: 文本 }`）
 */
async function requestJson(url: string, init: RequestInit): Promise<any> {
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (error: any) {
        // fetch 在网络层失败（DNS / 断网 / 证书）时抛 TypeError，消息为 "Failed to fetch"
        throw new Error(`网络请求失败：${(error && error.message) || error}`);
    }

    let text = "";
    try {
        text = await response.text();
    } catch (error: any) {
        text = "";
    }

    if (!response.ok) {
        const detail = snippet(text);
        throw new Error(`Request failed with status code ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    if (!text) return {};

    try {
        return JSON.parse(text);
    } catch (error) {
        // 有些自建网关会在 200 下返回纯文本译文
        return { raw: text };
    }
}

/**
 * 从 OpenAI 兼容响应中提取译文文本。
 *
 * 兼容多种返回形态：`choices[0].message.content`（字符串或内容块数组）、
 * `output.text` / `result` / `translatedText`，以及 200 下直接返回纯文本的网关。
 *
 * @param data 解析后的响应体
 *
 * @returns 提取到的文本（提取不到时为空串）
 */
export function extractContent(data: any): string {
    const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : undefined;

    if (typeof content === "string") {
        return content.trim();
    }

    if (Array.isArray(content)) {
        return content
            .map((part: any) => (typeof part === "string" ? part : (part && part.text) || ""))
            .join("")
            .trim();
    }

    const fallbacks = [data && data.output && data.output.text, data && data.result, data && data.translatedText, data && data.raw];
    for (const candidate of fallbacks) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    return "";
}

/**
 * 发起一次对话补全请求。
 *
 * @param config 服务商配置
 * @param body 请求体（OpenAI 兼容格式）
 *
 * @returns 解析后的响应体
 */
export async function chatCompletion(config: CustomProviderConfig, body: Record<string, unknown>): Promise<any> {
    const url = normalizeEndpoint(config && config.endpoint);
    return requestJson(url, {
        method: "POST",
        headers: buildHeaders(config),
        body: JSON.stringify(body),
    });
}

/**
 * 测试服务商连通性：发一次真实的最小翻译请求。
 *
 * 之所以不用 `/models` 或空请求做探活，是因为真正需要验证的是「这条链路能不能翻译」——
 * 地址、密钥、模型名、请求格式四者任一有问题，只有真实补全请求才能同时暴露。
 *
 * @param config 服务商配置（设置页未保存的草稿也能直接测）
 * @param sample 自定义测试样本
 *
 * @returns 测试结果（不抛异常，失败原因放在 message 里）
 */
export async function testProvider(
    config: CustomProviderConfig,
    sample?: { from?: string; to?: string; text?: string }
): Promise<ProviderTestResult> {
    const model = ((config && config.model) || "").trim();
    if (!model) {
        return { ok: false, message: "请先填写模型名称再测试" };
    }

    const from = (sample && sample.from) || "en";
    const to = (sample && sample.to) || "zh-CN";
    const text = (sample && sample.text) || "Hello, world.";

    try {
        const data = await chatCompletion(config, {
            model,
            messages: [
                {
                    role: "system",
                    content: `You are a professional translator. Translate the following text from ${from} to ${to}. Only return the translated text, no other content.`
                },
                { role: "user", content: text }
            ],
            temperature: 0.3,
            max_tokens: 256
        });

        const translated = extractContent(data);
        if (!translated) {
            return {
                ok: false,
                message: "接口有响应，但没能从返回里解析出译文。请确认该地址是 OpenAI 兼容的 /chat/completions 接口"
            };
        }

        return { ok: true, message: "连接成功", sample: translated };
    } catch (error: any) {
        return { ok: false, message: (error && error.message) || String(error) };
    }
}

/**
 * 拉取服务商可用的模型列表（OpenAI 兼容的 `GET /models`）。
 *
 * 兼容 `{data:[{id}]}`、`{models:[{id|name}]}`、`[{id}]` 等常见返回形态。
 *
 * @param config 服务商配置
 *
 * @returns 去重排序后的模型名数组
 *
 * @throws 请求失败或返回中不含模型列表时抛出，消息可直接展示给用户
 */
export async function fetchModels(config: CustomProviderConfig): Promise<string[]> {
    const url = deriveModelsEndpoint(config && config.endpoint);

    // GET 不需要 Content-Type，但鉴权头仍需保留
    const headers = buildHeaders(config);
    delete headers["Content-Type"];

    const data = await requestJson(url, { method: "GET", headers });

    const candidates: any[] = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.data) && data.data)
        || (data && Array.isArray(data.models) && data.models)
        || [];

    const models: string[] = [];
    for (const item of candidates) {
        const name = typeof item === "string" ? item : (item && (item.id || item.name)) || "";
        if (typeof name === "string" && name.trim()) {
            models.push(name.trim());
        }
    }

    if (models.length === 0) {
        throw new Error("未从返回中解析到模型列表，该服务商可能不支持 GET /models，请手动填写模型名称");
    }

    return Array.from(new Set(models)).sort();
}
