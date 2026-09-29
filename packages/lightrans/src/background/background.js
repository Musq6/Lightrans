import { TranslatorManager, translatePage } from "./library/translate.js";
import {
    addUrlBlacklist,
    addDomainBlacklist,
    removeUrlBlacklist,
    removeDomainBlacklist,
    updateBLackListMenu,
} from "./library/blacklist.js";
import { promiseTabs } from "common/scripts/promise.js";
import Channel from "common/scripts/channel.js";
import { getDomain } from "common/scripts/common.js";
// map language abbreviation from browser languages to translation languages
import { BROWSER_LANGUAGES_MAP } from "common/scripts/languages.js";
import { DEFAULT_SETTINGS, setDefaultSettings } from "common/scripts/settings.js";

/**
 * BEGIN SETTING UP CONTEXT MENUS
 */
// 确保 chrome.contextMenus 可用时才创建菜单
if (chrome.contextMenus) {
    // 创建选择翻译菜单
    chrome.contextMenus.create({
        id: "translate",
        title: `${chrome.i18n.getMessage("Translate")} '%s'`,
        contexts: ["selection"],
    });

    // Add an entry to options page for Firefox as it doesn't have one.
    if (BROWSER_ENV === "firefox") {
        chrome.contextMenus.create({
            id: "settings",
            title: chrome.i18n.getMessage("Settings"),
            contexts: ["action"],
        });
    }

    // 创建快捷键设置菜单
    chrome.contextMenus.create({
        id: "shortcut",
        title: chrome.i18n.getMessage("ShortcutSetting"),
        contexts: ["action"],
    });

    // 创建黑名单相关菜单
    chrome.contextMenus.create({
        id: "add_url_blacklist",
        title: chrome.i18n.getMessage("AddUrlBlacklist"),
        contexts: ["action"],
        enabled: false,
        visible: false,
    });

    chrome.contextMenus.create({
        id: "add_domain_blacklist",
        title: chrome.i18n.getMessage("AddDomainBlacklist"),
        contexts: ["action"],
        enabled: false,
        visible: false,
    });

    chrome.contextMenus.create({
        id: "remove_url_blacklist",
        title: chrome.i18n.getMessage("RemoveUrlBlacklist"),
        contexts: ["action"],
        enabled: false,
        visible: false,
    });

    chrome.contextMenus.create({
        id: "remove_domain_blacklist",
        title: chrome.i18n.getMessage("RemoveDomainBlacklist"),
        contexts: ["action"],
        enabled: false,
        visible: false,
    });
}
/**
 * END SETTING UP CONTEXT MENUS
 */

/**
 * 初始化插件配置。
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "update") {
        await new Promise((resolve) => {
            chrome.storage.sync.get((result) => {
                let buffer = result; // use var buffer as a pointer
                setDefaultSettings(buffer, DEFAULT_SETTINGS); // assign default value to buffer
                chrome.storage.sync.set(buffer, resolve);
            });
        });

        // Fix language setting compatibility between Edge Translate 2.x and 1.x.x.
        chrome.storage.sync.get("languageSetting", (result) => {
            if (!result.languageSetting) return;

            if (result.languageSetting.sl === "zh-cn") {
                result.languageSetting.sl = "zh-CN";
            } else if (result.languageSetting.sl === "zh-tw") {
                result.languageSetting.sl = "zh-TW";
            }

            if (result.languageSetting.tl === "zh-cn") {
                result.languageSetting.tl = "zh-CN";
            } else if (result.languageSetting.tl === "zh-tw") {
                result.languageSetting.tl = "zh-TW";
            }
            chrome.storage.sync.set(result);
        });
    }
});

/**
 * Create communication channel.
 */
const channel = new Channel();

/**
 * Create translator manager and register event listeners and service providers.
 */
const TRANSLATOR_MANAGER = new TranslatorManager(channel);



/**
 * 监听用户点击通知事件
 */
// 使用try-catch块来安全地添加notifications监听器，避免构建过程中的问题
try {
    // 尝试获取notifications对象
    const notifications = chrome && chrome.notifications;
    if (notifications) {
        // 尝试获取onClicked事件
        const onClicked = notifications.onClicked;
        if (onClicked) {
            onClicked.addListener((notificationId) => {
                if (notificationId) {
                    switch (notificationId) {
                        case "update_notification":
                            chrome.tabs.create({
                                // 为releases页面创建一个新的标签页
                                url: "https://github.com/W4J1e/Lightrans/releases",
                            });
                            break;
                        case "data_collection_notification":
                            chrome.tabs.create({
                                // 为设置页面单独创建一个标签页
                                url: chrome.runtime.getURL("options/options.html"),
                            });
                            break;
                        default:
                            break;
                    }
                }
            });
        }
    }
} catch (error) {
    // 忽略所有错误，避免影响扩展的其他功能
    console.error('lightrans: Error adding notifications listener:', error);
}

/**
 * 添加点击菜单后的处理事件
 */
// 使用try-catch块来安全地添加contextMenus监听器，避免构建过程中的问题
try {
    // 尝试获取contextMenus对象
    const contextMenus = chrome && chrome.contextMenus;
    if (contextMenus) {
        // 尝试添加监听器
        const onClicked = contextMenus.onClicked;
        if (onClicked) {
            onClicked.addListener((info, tab) => {
                if (info && info.menuItemId) {
                    switch (info.menuItemId) {
                        case "translate_page":
                            // 定制：点击「翻译此页面」直接使用设置中选择的模型，
                            // 不再弹出模型二级菜单（translatePage 不传 model 即走设置模型）
                            translatePage(channel);
                            break;
                        case "translate":
                            if (channel && tab && tab.id) {
                                channel
                                    .requestToTab(tab.id, "get_selection")
                                    .then(({ text, position, selectionHeight }) => {
                                        if (text) {
                                            return TRANSLATOR_MANAGER.translate(text, position, selectionHeight);
                                        }
                                        return Promise.reject();
                                    })
                                    .catch((error) => {
                                        // If content scripts can not access the tab the selection, use info.selectionText instead.
                                        if (info.selectionText && info.selectionText.trim()) {
                                            return TRANSLATOR_MANAGER.translate(info.selectionText, null);
                                        }
                                        return Promise.resolve(error);
                                    });
                            }
                            break;
                        case "settings":
                            chrome.runtime.openOptionsPage();
                            break;
                        case "shortcut":
                            chrome.tabs.create({
                                url: "chrome://extensions/shortcuts",
                            });
                            break;
                        case "add_url_blacklist":
                            addUrlBlacklist();
                            break;
                        case "remove_url_blacklist":
                            removeUrlBlacklist();
                            break;
                        case "add_domain_blacklist":
                            addDomainBlacklist();
                            break;
                        case "remove_domain_blacklist":
                            removeDomainBlacklist();
                            break;
                        default:
                            break;
                    }
                }
            });
        }
    }
} catch (error) {
    // 忽略所有错误，避免影响扩展的其他功能
    console.error('lightrans: Error adding contextMenus listener:', error);
}

/**
 * 添加tab切换事件监听，用于更新黑名单信息
 */
chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url && tab.url.length > 0) {
            updateBLackListMenu(tab.url);
        }
    });
});

/**
 * 添加tab刷新事件监听，用于更新黑名单信息
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && tab.url && tab.url.length > 0) {
        updateBLackListMenu(tab.url);
    }
});

/**
 * Redirect tab when redirect event happens.
 */
channel.on("redirect", (detail, sender) => chrome.tabs.update(sender.tab.id, { url: detail.url }));

/**
 * Open options page when open_options_page button clicked.
 */
channel.on("open_options_page", () => chrome.runtime.openOptionsPage());

/**
 * Forward page translate event back to pages.
 */
channel.on("page_translate_event", (detail, sender) => {
    channel.emitToTabs(sender.tab.id, "page_translate_event", detail);
});

/**
 * Provide UI language detecting service.
 */
channel.provide("get_lang", () => {
    return Promise.resolve({
        lang: BROWSER_LANGUAGES_MAP[chrome.i18n.getUILanguage()],
    });
});

/**
 * Handle page translation requests from content scripts.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRANSLATE_PAGE_CONTENT') {
        // 使用AI翻译器批量翻译网页内容（注入端已将短文本合并为批次）
        (async () => {
            // 确保配置已初始化
            await TRANSLATOR_MANAGER.config_loader;

            // 获取请求中的模型参数，默认为当前设置的模型
            const requestedModel = message.model && message.model !== 'default' ? message.model : TRANSLATOR_MANAGER.AI_MODEL;

            // 保存当前模型，用于翻译后恢复
            const originalModel = TRANSLATOR_MANAGER.AI_MODEL;

            // 如果请求的模型不同，临时切换模型
            if (requestedModel !== originalModel) {
                TRANSLATOR_MANAGER.AI_TRANSLATOR.setCurrentModel(requestedModel);
            }

            // 统一恢复模型并响应，保证任何路径下都会还原
            const finish = (payload) => {
                if (requestedModel !== originalModel) {
                    TRANSLATOR_MANAGER.AI_TRANSLATOR.setCurrentModel(originalModel);
                }
                sendResponse(payload);
            };

            try {
                const texts = message.content.texts;
                const targetLang = TRANSLATOR_MANAGER.LANGUAGE_SETTING.tl;

                // 批量翻译：内部自动处理编号合并、解析降级与单条兜底，
                // 与输入等长返回（失败项保留原文），无需在此再做逐条循环与固定节流。
                const translatedTexts = await TRANSLATOR_MANAGER.AI_TRANSLATOR.translateBatch(texts, 'auto', targetLang);

                finish({
                    translatedContent: {
                        texts: translatedTexts
                    }
                });
            } catch (error) {
                const errorMessage = String(error && error.message || error);

                // 瞬时错误（限流 429 / 中继透传的 502 等网关错误 / 网络抖动）：
                // 标记后交由注入端退避并重发本批（此时整批尚无产出，重试无损）
                if (/transient|429|rate\s*limit/i.test(errorMessage)) {
                    finish({ rateLimited: true, error: errorMessage });
                } else {
                    console.error('Page translation error:', error);
                    finish({ error: errorMessage });
                }
            }
        })();
        return true; // 表示我们将异步发送响应
    }
    return false;
});

/**
 *  将快捷键消息转发给content_scripts
 */
chrome.commands.onCommand.addListener((command) => {
    switch (command) {
        case "translate_page":
            translatePage(channel);
            break;
        default:
            promiseTabs
                .query({ active: true, currentWindow: true })
                .then((tabs) => channel.emitToTabs(tabs[0].id, "command", { command }))
                .catch(() => {});
            break;
    }
});





/**
 * dynamic importing hot reload function only in development env
 */
if (BUILD_ENV === "development" && BROWSER_ENV === "chrome") {
    import("./library/hot_reload.js").then((module) => {
        module.hotReload();
    });
}
