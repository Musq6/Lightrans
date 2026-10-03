/**
 * 自定义第三方服务商：设置解析。
 *
 * 独立成模块、并同时被**后台**与**设置页**引用的原因：
 * - `CustomProviders` 来自 chrome.storage.sync，可能被手工改坏、跨版本残留或同步成非数组，
 *   两边都不能直接信任其结构（`providers.find` 在非数组上会直接抛错）；
 * - 更关键的是：两边对「列表里有哪些项」必须得出**完全一致**的结论。若后台丢掉某一项
 *   而设置页保留，就会出现用户选中服务商 B、实际请求却发给了服务商 A 的静默错用。
 *   历史上正是这种「两边各自实现一遍归一化」的分叉最易出问题，故收敛到此处。
 */

/**
 * 把 storage 里的原始值规整成合法的服务商数组。
 *
 * 刻意**保留 endpoint 为空**的项：用户刚点「新增」时就是空的，若在此丢弃，
 * 后台会把它当作不存在并回退到别的服务商（静默错用），或设置页刷新后项就消失。
 * 空地址的问题由 AITranslator 在请求时抛出明确错误来解决——失败要响亮，不要悄悄换人。
 *
 * @param {*} raw storage 中 CustomProviders 的原始值
 *
 * @returns {Array<Object>} 规整后的服务商数组（字段齐全、id 唯一非空）
 */
export function normalizeProviders(raw) {
    if (!Array.isArray(raw)) return [];

    return raw
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
            // 缺少 id 的老数据用下标补一个稳定 id：同一份数据多次解析结果一致，
            // 避免热更新时选中项来回跳。两边用同一个函数，所以下标口径也一致。
            id: (typeof item.id === "string" && item.id.trim()) || `legacy-${index}`,
            name: typeof item.name === "string" ? item.name : "",
            endpoint: typeof item.endpoint === "string" ? item.endpoint : "",
            apiKey: typeof item.apiKey === "string" ? item.apiKey : "",
            model: typeof item.model === "string" ? item.model : "",
            headers: typeof item.headers === "string" ? item.headers : "",
        }));
}

/**
 * 取当前生效的服务商。
 *
 * @param {Array<Object>} providers 已规整的服务商数组
 * @param {string} activeId 设置中记录的选中 id
 *
 * @returns {Object|null} 选中的服务商；列表为空时返回 null
 */
export function resolveActiveProvider(providers, activeId) {
    if (!Array.isArray(providers) || providers.length === 0) return null;

    const wanted = typeof activeId === "string" ? activeId.trim() : "";
    if (wanted) {
        const matched = providers.find((provider) => provider.id === wanted);
        if (matched) return matched;
    }

    // id 失配（例：另一台设备删除了该项，同步后本地 activeId 悬空）→ 回退首项，
    // 而不是判定「没有服务商」，否则用户会看到莫名其妙的「请先添加服务商」。
    return providers[0];
}
