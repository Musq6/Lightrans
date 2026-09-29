/**
 * 整页翻译译文样式（对照模式下插入页面的译文）
 *
 * 作用：把设置里的 PageTranslationStyle 解析成一段可直接赋给
 * `span.style.cssText` 的 CSS 文本。
 *
 * 为什么是「解析成字符串」而不是像划词面板那样用 ThemeProvider：
 * 整页翻译的译文是由 background 通过 chrome.scripting.executeScript 注入到
 * 目标页面里执行的，注入函数会被序列化，运行时无法 import 任何模块。
 * 因此样式必须在注入**之前**在 background 里算好，以字符串形式经 args 传入。
 *
 * 注意：这套配置只负责整页翻译的译文，与划词翻译结果框的 DisplayStyle 完全独立，
 * 改这里不会影响划词结果面板，反之亦然。
 */

/** 强调色预设：左侧色条 / 下划线颜色 / 高亮底色 */
const ACCENTS = {
    blue: {
        line: "#2f6bff",
        tintLight: "rgba(47, 107, 255, 0.12)",
        tintDark: "rgba(96, 140, 255, 0.24)",
    },
    green: {
        line: "#12a150",
        tintLight: "rgba(18, 161, 80, 0.12)",
        tintDark: "rgba(58, 196, 122, 0.24)",
    },
    orange: {
        line: "#e8830c",
        tintLight: "rgba(232, 131, 12, 0.14)",
        tintDark: "rgba(244, 168, 66, 0.24)",
    },
    gray: {
        line: "#8b93a1",
        tintLight: "rgba(139, 147, 161, 0.16)",
        tintDark: "rgba(168, 178, 192, 0.24)",
    },
};

/**
 * 字号预设（相对原文，用 em 跟随网页自身的字号缩放）。
 *
 * 档位刻意拉开：相邻两档相差约 15%～20%。
 * 早期取值 0.85 / 0.92 / 1 相邻只差 8%，实测几乎看不出区别。
 * medium 保持 0.92em 不变，以维持与上游一致的默认观感。
 */
const FONT_SIZES = {
    small: "0.8em",
    medium: "0.92em",
    large: "1.1em",
};

/** 圆角预设 */
const RADII = {
    none: "0px",
    small: "4px",
    medium: "8px",
    large: "12px",
};

/**
 * 色块 / 高亮外观的承载面配色。
 * 这两种外观自带底色，深色网页上需要换成深底浅字，因此由 DarkMode 切换。
 */
const SURFACE = {
    light: { bg: "#f5f7fa", text: "#3a4252" },
    dark: { bg: "rgba(28, 32, 40, 0.92)", text: "#e6eaf2" },
};

/** PageTranslationStyle 的默认值（与 settings.js 中的默认设置保持一致） */
export const DEFAULT_PAGE_TRANSLATION_STYLE = {
    Theme: "block",
    Accent: "blue",
    FontSize: "medium",
    Radius: "small",
    DarkMode: false,
};

/**
 * 从映射表按 key 取值，缺失时回退
 *
 * @param {Object} map 映射表
 * @param {string} key 键
 * @param {*} fallback 回退值
 * @returns {*} 取值结果
 */
function pick(map, key, fallback) {
    return key in map ? map[key] : fallback;
}

/**
 * 把 PageTranslationStyle 设置解析成一段 CSS 文本。
 *
 * Theme 的四种外观：
 * - block     色块：浅（或深）色底 + 左侧强调色条 + 圆角
 * - highlight 高亮：强调色半透明底 + 圆角
 * - underline 下划线：无底色，虚线下边框；文字颜色继承网页原文
 * - plain     纯文字：无任何装饰，颜色与排版完全继承网页原文
 *
 * underline / plain 不带底色，因此不做深色适配——直接继承网页原文颜色，
 * 在任何配色的网页上都不会出现对比度问题。
 *
 * @param {Object} [settings] chrome.storage 中的 PageTranslationStyle 设置，可为空
 * @returns {string} 可赋给 span.style.cssText 的 CSS 文本
 */
export function resolvePageTranslationStyleCss(settings) {
    const current = { ...DEFAULT_PAGE_TRANSLATION_STYLE, ...(settings || {}) };
    const accent = pick(ACCENTS, current.Accent, ACCENTS.blue);
    const size = pick(FONT_SIZES, current.FontSize, FONT_SIZES.medium);
    const radius = pick(RADII, current.Radius, RADII.small);
    const surface = current.DarkMode ? SURFACE.dark : SURFACE.light;

    // display:block 让译文始终独占一行，落在原文下方，行为与上游一致
    const base = `display:block;margin:2px 0 6px;font-size:${size};line-height:1.5;`;

    switch (current.Theme) {
        case "highlight":
            return (
                `${base}padding:1px 4px;` +
                `background:${current.DarkMode ? accent.tintDark : accent.tintLight};` +
                `color:${surface.text};border-radius:${radius};`
            );

        case "underline":
            return `${base}padding:0 0 2px;border-bottom:1px dashed ${accent.line};`;

        case "plain":
            return base;

        case "block":
        default:
            return (
                `${base}padding:2px 6px;` +
                `background:${surface.bg};border-left:3px solid ${accent.line};` +
                `color:${surface.text};border-radius:${radius};`
            );
    }
}
