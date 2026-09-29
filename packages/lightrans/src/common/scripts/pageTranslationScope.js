/**
 * 整页翻译范围（轻量档）：把设置里的 PageTranslationScope 解析成注入函数可直接使用的开关。
 *
 * 为什么单独一个模块：注入函数由 chrome.scripting.executeScript 序列化后送到目标页面执行，
 * 运行时无法 import 任何模块，所以「读设置 → 解析 → 通过 args 传入」这条链路必须在
 * background 侧完成，解析结果也必须是可 JSON 序列化的普通对象（同 pageTranslationStyle.js）。
 *
 * 三个开关都默认开启：它们的共同目标是把站点框架（页眉、导航、吸顶栏、隐藏内容）
 * 排除在翻译之外，避免页面顶部与非正文区域被翻译后变得杂乱。
 */

export const DEFAULT_PAGE_TRANSLATION_SCOPE = {
    SkipInvisible: true,
    SkipSticky: true,
    SkipSemanticChrome: true,
};

export function resolvePageTranslationScope(settings) {
    const src = settings && typeof settings === "object" ? settings : {};
    const pick = (key) =>
        typeof src[key] === "boolean" ? src[key] : DEFAULT_PAGE_TRANSLATION_SCOPE[key];

    return {
        SkipInvisible: pick("SkipInvisible"),
        SkipSticky: pick("SkipSticky"),
        SkipSemanticChrome: pick("SkipSemanticChrome"),
    };
}
