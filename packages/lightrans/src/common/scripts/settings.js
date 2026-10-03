import { BROWSER_LANGUAGES_MAP } from "common/scripts/languages.js";

/**
 * default settings for this extension
 */
const DEFAULT_SETTINGS = {
    blacklist: {
        urls: {},
        domains: { "chrome.google.com": true, extensions: true },
    },
    // Resize: determine whether the web page will resize when showing translation result
    // RTL: determine whether the text in translation block should display from right to left
    // FoldLongContent: determine whether to fold long translation content
    // SelectTranslatePosition: the position of select translate button.
    LayoutSettings: {
        Resize: false,
        RTL: false,
        FoldLongContent: true,
        SelectTranslatePosition: "TopRight",
    },
    // Default settings of source language and target language
    languageSetting: { sl: "auto", tl: BROWSER_LANGUAGES_MAP[chrome.i18n.getUILanguage()] },
    // 划词翻译结果框的显示样式（与整页翻译的 PageTranslationStyle 相互独立）
    // PanelStyle: 面板外观预设 glass(毛玻璃) / solid(纯色) / dark(深色)
    // TextColor: 文字颜色 auto(跟随外观) / dark / light
    // FontSize: 字号 small / medium / large
    // CornerRadius: 圆角 none / small / medium / large
    // Shadow: 是否显示面板阴影
    DisplayStyle: {
        PanelStyle: "glass",
        TextColor: "auto",
        FontSize: "medium",
        CornerRadius: "medium",
        Shadow: true,
    },
    OtherSettings: {
        MutualTranslate: true,
        SelectTranslate: true,
        TranslateAfterDblClick: false,
        TranslateAfterSelect: false,
        CancelTextSelection: false,
        UseGoogleAnalytics: true,
        UsePDFjs: true,
    },
    DefaultTranslator: "AITrans",
    AIModel: "THUDM/GLM-4-9B-0414",
    DefaultPageTranslator: "AITrans",
    // Page translation display mode: "original" / "translated" / "bilingual"
    PageTranslationDisplayMode: "translated",
    // 整页翻译对照模式下插入页面的译文样式（与划词结果框的 DisplayStyle 相互独立）
    // Theme: 译文外观 block(色块) / highlight(高亮) / underline(下划线) / plain(纯文字)
    // Accent: 强调色 blue / green / orange / gray
    // FontSize: 字号 small / medium / large（相对原文的 0.85 / 0.92 / 1 em）
    // Radius: 圆角 none / small / medium / large
    // DarkMode: 深色网页适配，开启后色块与高亮使用深底浅字
    PageTranslationStyle: {
        Theme: "block",
        Accent: "blue",
        FontSize: "medium",
        Radius: "small",
        DarkMode: false,
    },
    // 整页翻译范围：决定页面里哪些文本参与翻译（与译文样式相互独立；改动后需重新翻译本页才生效）
    // SkipInvisible: 跳过不可见内容（display:none / visibility:hidden / opacity:0 / aria-hidden）
    // SkipSticky: 跳过吸顶导航与悬浮层（position: fixed / sticky，且未占满视口）
    // SkipSemanticChrome: 跳过导航、页眉页脚、侧栏等站点框架（语义标签 / ARIA 角色 / class-id 关键词）
    PageTranslationScope: {
        SkipInvisible: true,
        SkipSticky: true,
        SkipSemanticChrome: true,
    },
    // 翻译服务模式：
    // - free      硅基流动（免费），走我们的反代服务，零配置免 Key
    // - custom    硅基流动（自定义），直连官方 + 自有 Key
    // - provider  自定义服务商，使用 CustomProviders 里选中的第三方 OpenAI 兼容接口
    TranslationService: "free",
    // 自定义模式下使用的 SiliconFlow API Key（仅 custom 模式读取）
    ApiKey: "",
    // 自定义模式下是否使用用户自己输入的模型名称（勾选后模型选择框变为可输入）
    CustomModel: false,
    // 自定义模型名称（CustomModel 为 true 时生效，翻译时作为 model 字段直连硅基流动）
    CustomModelName: "",
    // 自定义第三方服务商列表（仅 provider 模式读取）。每项结构：
    // { id, name, endpoint, apiKey, model, headers }
    // 存于 storage.sync 会随账号同步，注意单条目的 8KB 配额（几十个服务商无压力）
    CustomProviders: [],
    // 当前选中的自定义服务商 id（仅 provider 模式读取；找不到时回退到列表首项）
    ActiveProviderId: "",
    HybridTranslatorConfig: {
        // The translators used in current hybrid translate.
        translators: ["AITrans"],

        // The translators for each item.
        selections: {
            // ATTENTION: The following four items MUST HAVE THE SAME TRANSLATOR!
            originalText: "AITrans",
            mainMeaning: "AITrans",
            tPronunciation: "AITrans",
            sPronunciation: "AITrans",

            // For the following three items, any translator combination is OK.
            detailedMeanings: "AITrans",
            definitions: "AITrans",
            examples: "AITrans",
        },
    },
    HidePageTranslatorBanner: false,
};

/**
 * assign default value to settings which are undefined in recursive way
 * @param {*} result setting result stored in chrome.storage
 * @param {*} settings default settings
 */
function setDefaultSettings(result, settings) {
    for (let i in settings) {
        // settings[i] contains key-value settings
        if (
            typeof settings[i] === "object" &&
            !(settings[i] instanceof Array) &&
            Object.keys(settings[i]).length > 0
        ) {
            if (result[i]) {
                setDefaultSettings(result[i], settings[i]);
            } else {
                // settings[i] contains several setting items but these have not been set before
                result[i] = settings[i];
            }
        } else if (result[i] === undefined) {
            // settings[i] is a single setting item and it has not been set before
            result[i] = settings[i];
        }
    }
}

/**
 * Get settings from storage. If some of the settings have not been initialized,
 * initialize them with the given default values.
 *
 * @param {String | Array<String>} settings setting name to get
 * @param {Object | Function} defaults default values or function to generate default values
 * @returns {Promise<Any>} settings
 */
function getOrSetDefaultSettings(settings, defaults) {
    return new Promise((resolve) => {
        // If there is only one setting to get, warp it up.
        if (typeof settings === "string") {
            settings = [settings];
        } else if (settings === undefined) {
            // If settings is undefined, collect all setting keys in defaults.
            settings = [];
            for (let key in defaults) {
                settings.push(key);
            }
        }

        chrome.storage.sync.get(settings, (result) => {
            let updated = false;

            for (let setting of settings) {
                if (!result[setting]) {
                    if (typeof defaults === "function") {
                        defaults = defaults(settings);
                    }
                    result[setting] = defaults[setting];
                    updated = true;
                }
            }

            if (updated) {
                chrome.storage.sync.set(result, () => resolve(result));
            } else {
                resolve(result);
            }
        });
    });
}

export { DEFAULT_SETTINGS, setDefaultSettings, getOrSetDefaultSettings };
