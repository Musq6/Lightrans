/**
 * 划词结果框顶部「翻译来源」下拉的数据构造。
 *
 * 单独成模块的两个原因：
 * - 这里必须与后台**共用同一套选中项解析**（`resolveActiveProvider`）。否则会出现
 *   下拉标题显示服务商 A、实际请求发给服务商 B——一种只体现为「结果不对」的错误。
 * - 判断逻辑（下拉里列什么、当前选哪个）是纯函数，可以脱离 Preact 与 DOM 单独测试，
 *   而 Panel.jsx 里的副作用部分没法这么测。
 */

import { resolveActiveProvider } from "./customProviderSettings.js";

/**
 * 把一个服务商格式化成下拉项文案。
 *
 * 优先「名称 · 模型」——只显示模型名会让两个用同一模型的服务商无法区分，
 * 只显示名称又看不出到底在用什么模型。名称/模型缺任一时退回另一个，
 * 两者都空时用接口地址兜底，保证不会出现空白项。
 *
 * @param {Object} provider 服务商配置
 *
 * @returns {string} 展示文案
 */
export function formatProviderLabel(provider) {
    if (!provider || typeof provider !== "object") return "";

    const name = (provider.name || "").trim();
    const model = (provider.model || "").trim();

    if (name && model) return `${name} · ${model}`;
    return name || model || (provider.endpoint || "").trim();
}

/**
 * 构造下拉项列表。
 *
 * - provider 模式：一项对应一个自定义服务商，key 用服务商 id（切换即换服务商）；
 * - 其余模式：一项对应一个内置模型，key 用模型名（与上游行为一致）。
 *
 * 这里**不过滤**未配置完整的服务商：列表要与设置页保持一致，
 * 否则用户会以为刚加的服务商丢了。真去用它时，后台会返回明确的原因
 * （「选中的服务商还没填接口地址」），比静默少一项更好排查。
 *
 * @param {{mode: string, providers?: Array<Object>, models?: Array<string>}} state 当前状态
 *
 * @returns {Array<{key: string, label: string, provider: Object|null}>} 下拉项
 */
export function buildModelOptions(state) {
    // 兜底成对象再取字段：这个函数的输入来自通道消息与 storage 快照，
    // 缺字段或整个为 undefined 都是可能的（后台服务重启的瞬间就会），
    // 直接访问 state.models 会抛错并让整块结果框渲染失败。
    const source = state && typeof state === "object" ? state : {};
    const mode = source.mode || "free";

    if (mode === "provider") {
        const providers = Array.isArray(source.providers) ? source.providers : [];
        return providers.map((provider) => ({
            key: provider.id,
            label: formatProviderLabel(provider),
            provider,
        }));
    }

    const models = Array.isArray(source.models) ? source.models : [];
    return models.map((model) => ({ key: model, label: model, provider: null }));
}

/**
 * 求当前应选中哪个下拉项。
 *
 * provider 模式下复用 `resolveActiveProvider`：id 命中则用它，否则回退列表首项——
 * 与后台 `applyCustomProvider()` 的取值规则完全相同。这是「下拉显示的就是实际在用的」
 * 这条保证的关键。
 *
 * @param {{mode: string, providers?: Array<Object>, activeId?: string, currentModel?: string}} state
 *
 * @returns {string} 选中项的 key；无可用项时为空串
 */
export function pickActiveModelKey(state) {
    const source = state && typeof state === "object" ? state : {};
    const mode = source.mode || "free";

    if (mode === "provider") {
        // 与后台 applyCustomProvider() 的取值规则完全相同：id 命中则用它，否则回退列表首项。
        // 这是「下拉显示的就是实际在用的」这条保证的关键。
        const active = resolveActiveProvider(source.providers, source.activeId);
        return active ? active.id : "";
    }

    return source.currentModel || "";
}
