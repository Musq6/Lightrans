/**
 * 划词结果框顶部「翻译来源」下拉的数据构造。
 *
 * 单独成模块的两个原因：
 * - 这里必须与后台**共用同一套选中项解析**（`resolveActiveProvider`）。否则会出现
 *   下拉标题显示服务商 A、实际请求发给服务商 B——一种只体现为「结果不对」的错误。
 * - 判断逻辑（下拉里列什么、当前选哪个）是纯函数，可以脱离 Preact 与 DOM 单独测试，
 *   而 Panel.jsx 里的副作用部分没法这么测。
 */

import { resolveActiveProvider, resolveActiveModel } from "./customProviderSettings.js";

/**
 * 为一个「服务商 + 模型」组合生成下拉项 key。
 *
 * 用 JSON 数组编码而不是 `${id} :: ${model}` 这类可读分隔符：服务商 id 虽然是 UUID（安全），
 * 但**模型名可以包含任意字符**，包括分隔符本身——`("a", "b :: c")` 与 `("a :: b", "c")`
 * 会拼出同一个字符串，两个不同的组合撞成一个 key，切换就会切错。
 * JSON 数组编码按构造即无歧义，代价只是 key 在 devtools 里不那么好读。
 *
 * @param {string} providerId 服务商 id
 * @param {string} model 模型名
 *
 * @returns {string} key
 */
export function makeModelKey(providerId, model) {
    return JSON.stringify([providerId, model]);
}

/**
 * 格式化「某个服务商下的某个模型」的展示文案。
 *
 * @param {Object} provider 服务商配置
 * @param {string} model 模型名
 *
 * @returns {string} 展示文案
 */
export function formatProviderModelLabel(provider, model) {
    const name = (provider && provider.name ? provider.name : "").trim();
    const modelName = (model || "").trim();

    if (name && modelName) return `${name} · ${modelName}`;
    return name || modelName || ((provider && provider.endpoint) || "").trim();
}

/**
 * 格式化「某服务商当前使用的模型」的展示文案。
 *
 * @param {Object} provider 服务商配置
 *
 * @returns {string} 展示文案
 */
export function formatProviderLabel(provider) {
    if (!provider || typeof provider !== "object") return "";
    return formatProviderModelLabel(provider, resolveActiveModel(provider));
}

/**
 * 构造下拉项列表。
 *
 * - provider 模式：一项对应一个**「服务商 + 模型」组合**。一个服务商可以配多个模型，
 *   只按服务商列一项的话，这个下拉就只能换服务商、换不了模型，多模型的配置等于白配；
 * - 其余模式：一项对应一个内置模型，key 用模型名（与上游行为一致）。
 *
 * 这里**不过滤**未配置完整的服务商：列表要与设置页保持一致，否则用户会以为刚加的服务商丢了。
 * 真去用它时，后台会返回明确的原因（「选中的服务商还没填接口地址」），比静默少一项更好排查。
 * 没有模型的服务商则**不会**产生下拉项——它没有任何可用模型，列出来也无法翻译。
 *
 * @param {{mode: string, providers?: Array<Object>, models?: Array<string>}} state 当前状态
 *
 * @returns {Array<{key: string, label: string, providerId: string|null, model: string|null}>} 下拉项
 */
export function buildModelOptions(state) {
    // 兜底成对象再取字段：这个函数的输入来自通道消息与 storage 快照，
    // 缺字段或整个为 undefined 都是可能的（后台服务重启的瞬间就会），
    // 直接访问 state.models 会抛错并让整块结果框渲染失败。
    const source = state && typeof state === "object" ? state : {};
    const mode = source.mode || "free";

    if (mode === "provider") {
        const providers = Array.isArray(source.providers) ? source.providers : [];
        const options = [];

        for (const provider of providers) {
            const models = Array.isArray(provider.models) ? provider.models : [];
            for (const model of models) {
                options.push({
                    key: makeModelKey(provider.id, model),
                    label: formatProviderModelLabel(provider, model),
                    providerId: provider.id,
                    model,
                });
            }
        }

        return options;
    }

    const models = Array.isArray(source.models) ? source.models : [];
    return models.map((model) => ({ key: model, label: model, providerId: null, model: null }));
}

/**
 * 求当前应选中哪个下拉项。
 *
 * provider 模式下**依次复用** `resolveActiveProvider` 与 `resolveActiveModel`：
 * 先定服务商（id 命中则用它，否则回退列表首项），再定该服务商的模型（activeModel 命中则用它，
 * 否则回退该服务商的首个模型）。与后台 `applyCustomProvider()` 的取值规则完全相同——
 * 这是「下拉高亮的就是实际在用的」这条保证的关键。
 *
 * @param {{mode: string, providers?: Array<Object>, activeId?: string, currentModel?: string}} state
 *
 * @returns {string} 选中项的 key；无可用项时为空串
 */
export function pickActiveModelKey(state) {
    const source = state && typeof state === "object" ? state : {};
    const mode = source.mode || "free";

    if (mode === "provider") {
        const active = resolveActiveProvider(source.providers, source.activeId);
        if (!active) return "";

        const model = resolveActiveModel(active);
        // 没有模型时不返回 key：此时 buildModelOptions 也不会为它生成任何项，
        // 返回一个不存在的 key 会让下拉「没有一项被高亮、标题空白」。
        return model ? makeModelKey(active.id, model) : "";
    }

    return source.currentModel || "";
}

/**
 * 求当前选中项的展示文案（结果框标题用）。
 *
 * 命中下拉项时直接用它自己的 label；**不命中时退回服务商名**——典型情形是选中的服务商
 * 还没有配模型，此时下拉里没有对应项。若直接把标题留空，用户看到的是一个空白的下拉，
 * 会以为面板坏了，而不是「这个服务商还没配模型」。
 *
 * @param {{mode: string, providers?: Array<Object>, models?: Array<string>, activeId?: string,
 *   currentModel?: string}} state 当前状态
 *
 * @returns {string} 展示文案；确实没有可显示的内容时为空串
 */
export function pickActiveModelLabel(state) {
    const source = state && typeof state === "object" ? state : {};
    const key = pickActiveModelKey(source);
    const matched = buildModelOptions(source).find((option) => option.key === key);
    if (matched) return matched.label;

    if ((source.mode || "free") === "provider") {
        const active = resolveActiveProvider(source.providers, source.activeId);
        return active ? formatProviderLabel(active) : "";
    }

    return "";
}
