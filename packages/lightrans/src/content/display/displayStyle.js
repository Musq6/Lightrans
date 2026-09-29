/**
 * 译文显示样式（划词翻译结果框）
 *
 * 把设置里的 DisplayStyle 解析成一组可直接用于 styled-components 的样式值，
 * 供结果面板（Panel.jsx / Result.jsx / Error.jsx）与模型下拉菜单（Dropdown.jsx）消费。
 *
 * 注意：这里只负责**划词翻译的结果框**。整页翻译对照模式下插入页面的译文样式
 * 是另一套配置（PageTranslationStyle），见 common/scripts/pageTranslationStyle.js，
 * 两者互相独立。
 *
 * 设计说明：
 * - PanelStyle 决定一整套外观基调（底色 / 模糊 / 边框 / 内容块底色 / 次级文字色 / 细线色），
 *   是一组联动值，单独拆开配置会很容易配出不好看的组合，因此整体以预设的形式提供；
 * - TextColor / FontSize / CornerRadius / Shadow 是在基调之上可以再微调的独立项。
 */

/** 内容块圆角相对面板圆角的收窄量（px） */
const BLOCK_RADIUS_INSET = 2;

/** 字号预设（px） */
export const FONT_SIZES = {
    small: 14,
    medium: 16,
    large: 18,
};

/** 圆角预设（px） */
export const CORNER_RADII = {
    none: 0,
    small: 8,
    medium: 14,
    large: 20,
};

/** TextColor 为 dark / light 时强制使用的文字色 */
const FORCED_TEXT_COLORS = {
    dark: "#1f2430",
    light: "#f2f5f9",
};

/** 承载面板基础字号的 CSS 变量名（由 Panel 注入，供内部所有元素折算） */
export const FONT_SIZE_VAR = "--lr-fs";

/**
 * 结果框内各元素的字号比例（相对面板基础字号）。
 *
 * 为什么不直接写 font-size: small / medium / large：
 * 这些是 CSS 的「绝对字号关键字」，按浏览器默认字号（16px）解析，
 * **完全不随父级 font-size 缩放**。所以把字号设在面板容器上时，
 * 内容区里所有写了绝对关键字的文字都纹丝不动——字号设置等于没生效。
 *
 * 也不适合一律换成 em：em 相对**直接父级**，而这里存在
 * 「small 容器里套 medium 子元素」（如 ExampleItem 里的 ExampleSource），
 * 逐层相乘会算错。因此统一改成 `calc(var(--lr-fs) * 比例)`，
 * 不论嵌套多深都严格等于「面板字号 × 比例」。
 *
 * 比例按 16px 基准折算，取值与上游的绝对关键字**逐像素一致**：
 * Chrome 实测 small = 13px、medium = 16px、large = 18px、下拉菜单 = 14px，
 * 即 13/16 = 0.8125、1、18/16 = 1.125、14/16 = 0.875。
 * 这样「中」档的观感与改动前完全相同，只有小/大档才会缩放。
 */
export const FONT_SCALE = {
    small: 0.8125,
    medium: 1,
    large: 1.125,
    dropdown: 0.875,
};

/**
 * 生成一个锚定「面板基础字号」的字号表达式。
 *
 * 16px 是兜底值：组件若被用在 Panel 之外（没有 --lr-fs），
 * 表达式仍能求出与上游一致的绝对尺寸。
 *
 * @param {number} ratio 相对面板基础字号的比例，见 FONT_SCALE
 * @returns {string} 可直接放进 font-size 的 calc() 表达式
 */
export const fs = (ratio) => `calc(var(${FONT_SIZE_VAR}, 16px) * ${ratio})`;

/**
 * 面板外观预设。
 *
 * 每个预设提供：面板底色/模糊/边框/阴影、内容块底色/边框/阴影、
 * 头部条底色/分隔线、次级文字色、细线色、图标按钮与下拉菜单配色。
 */
const PANEL_STYLE_PRESETS = {
    // 毛玻璃（默认，保持原本的观感）
    glass: {
        panelBg: "rgba(255, 255, 255, 0.7)",
        panelBlur: "blur(20px) saturate(180%)",
        panelBorder: "none",
        panelShadow: "0 12px 40px rgba(31, 41, 55, 0.22), 0 2px 8px rgba(31, 41, 55, 0.1)",
        panelColor: "#1f2430",
        panelShine: "linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 100%)",
        headBg: "linear-gradient(180deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 100%)",
        headBorderBottom: "1px solid rgba(0, 0, 0, 0.06)",
        // 折叠长内容时的渐隐底色（与内容块底色一致）
        fadeRgb: "255, 255, 255",
        blockBg: "rgba(255, 255, 255, 0.82)",
        blockBorder: "1px solid rgba(0, 0, 0, 0.06)",
        blockShadow: "0 1px 2px rgba(31, 41, 55, 0.05)",
        secondaryColor: "#5f6368",
        hairline: "rgba(0, 0, 0, 0.12)",
        hairlineStrong: "rgba(0, 0, 0, 0.25)",
        iconButtonBg: "rgba(0, 0, 0, 0.04)",
        iconButtonBgHover: "rgba(0, 0, 0, 0.08)",
        menuBg: "rgba(255, 255, 255, 0.96)",
        menuBlur: "blur(12px)",
        menuBorder: "1px solid rgba(0, 0, 0, 0.06)",
        menuShadow: "0 12px 32px rgba(31, 41, 55, 0.18)",
        menuItemColor: "#3c4250",
        menuItemHoverBg: "rgba(0, 0, 0, 0.05)",
    },

    // 纯色卡片：不透明、边界清晰
    solid: {
        panelBg: "#ffffff",
        panelBlur: "none",
        panelBorder: "1px solid rgba(0, 0, 0, 0.08)",
        panelShadow: "0 8px 28px rgba(31, 41, 55, 0.16)",
        panelColor: "#1f2430",
        panelShine: "none",
        headBg: "#f4f6f9",
        headBorderBottom: "1px solid rgba(0, 0, 0, 0.07)",
        fadeRgb: "247, 248, 250",
        blockBg: "#f7f8fa",
        blockBorder: "1px solid rgba(0, 0, 0, 0.06)",
        blockShadow: "none",
        secondaryColor: "#5f6368",
        hairline: "rgba(0, 0, 0, 0.12)",
        hairlineStrong: "rgba(0, 0, 0, 0.2)",
        iconButtonBg: "rgba(0, 0, 0, 0.04)",
        iconButtonBgHover: "rgba(0, 0, 0, 0.08)",
        menuBg: "#ffffff",
        menuBlur: "none",
        menuBorder: "1px solid rgba(0, 0, 0, 0.08)",
        menuShadow: "0 12px 32px rgba(31, 41, 55, 0.18)",
        menuItemColor: "#3c4250",
        menuItemHoverBg: "rgba(0, 0, 0, 0.05)",
    },

    // 深色
    dark: {
        panelBg: "rgba(28, 31, 38, 0.92)",
        panelBlur: "blur(20px) saturate(160%)",
        panelBorder: "1px solid rgba(255, 255, 255, 0.1)",
        panelShadow: "0 12px 40px rgba(0, 0, 0, 0.45)",
        panelColor: "#e8ecf2",
        panelShine: "linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0) 100%)",
        headBg: "linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0) 100%)",
        headBorderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        fadeRgb: "38, 42, 51",
        blockBg: "rgba(255, 255, 255, 0.06)",
        blockBorder: "1px solid rgba(255, 255, 255, 0.1)",
        blockShadow: "none",
        secondaryColor: "#9aa4b2",
        hairline: "rgba(255, 255, 255, 0.16)",
        hairlineStrong: "rgba(255, 255, 255, 0.28)",
        iconButtonBg: "rgba(255, 255, 255, 0.08)",
        iconButtonBgHover: "rgba(255, 255, 255, 0.16)",
        menuBg: "rgba(38, 42, 51, 0.98)",
        menuBlur: "blur(12px)",
        menuBorder: "1px solid rgba(255, 255, 255, 0.12)",
        menuShadow: "0 12px 32px rgba(0, 0, 0, 0.5)",
        menuItemColor: "#d7dde6",
        menuItemHoverBg: "rgba(255, 255, 255, 0.1)",
    },
};

/** DisplayStyle 的默认值（与 settings.js 中的默认设置保持一致） */
export const DEFAULT_DISPLAY_STYLE = {
    PanelStyle: "glass",
    TextColor: "auto",
    FontSize: "medium",
    CornerRadius: "medium",
    Shadow: true,
};

/**
 * 从映射表按 key 取值，缺失时回退（避免 0 被 || 误判为缺失）
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
 * 把 DisplayStyle 设置解析成一组样式值。
 *
 * @param {Object} [settings] chrome.storage 中的 DisplayStyle 设置，可为空
 * @returns {Object} 样式值对象，字段含义见 PANEL_STYLE_PRESETS
 */
export function resolveDisplayStyle(settings) {
    const current = { ...DEFAULT_DISPLAY_STYLE, ...(settings || {}) };
    // 未知外观（例如旧版本存下的 transparent）一律回退到毛玻璃
    const preset = PANEL_STYLE_PRESETS[current.PanelStyle] || PANEL_STYLE_PRESETS.glass;

    const radius = pick(CORNER_RADII, current.CornerRadius, CORNER_RADII.medium);
    const fontSize = pick(FONT_SIZES, current.FontSize, FONT_SIZES.medium);

    // 文字颜色：auto 跟随外观基调，dark / light 为强制覆盖
    const panelColor = FORCED_TEXT_COLORS[current.TextColor] || preset.panelColor;

    return {
        // 面板容器
        panelBg: preset.panelBg,
        panelBlur: preset.panelBlur,
        panelBorder: preset.panelBorder,
        panelShadow: current.Shadow ? preset.panelShadow : "none",
        panelColor,
        panelRadius: radius,
        fontSize,
        // 面板顶部高光（毛玻璃的「玻璃感」来源）
        panelShine: preset.panelShine,
        // 头部工具条
        headBg: preset.headBg,
        headBorderBottom: preset.headBorderBottom,
        // 内容块
        blockBg: preset.blockBg,
        blockBorder: preset.blockBorder,
        blockShadow: preset.blockShadow,
        blockRadius: Math.max(0, radius - BLOCK_RADIUS_INSET),
        // 折叠长内容时渐隐到底色；null 表示关闭遮罩
        fadeRgb: preset.fadeRgb,
        // 次级文字与细线
        secondaryColor: preset.secondaryColor,
        hairline: preset.hairline,
        hairlineStrong: preset.hairlineStrong,
        // 图标按钮
        iconButtonBg: preset.iconButtonBg,
        iconButtonBgHover: preset.iconButtonBgHover,
        // 下拉菜单
        menuBg: preset.menuBg,
        menuBlur: preset.menuBlur,
        menuBorder: preset.menuBorder,
        menuShadow: preset.menuShadow,
        menuItemColor: preset.menuItemColor,
        menuItemHoverBg: preset.menuItemHoverBg,
    };
}
