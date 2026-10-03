import { AITranslator, testProvider, fetchModels } from "@lightrans/translators";
import { log } from "common/scripts/common.js";
import { promiseTabs, delayPromise } from "common/scripts/promise.js";
import { DEFAULT_SETTINGS, getOrSetDefaultSettings } from "common/scripts/settings.js";
import { resolvePageTranslationStyleCss } from "common/scripts/pageTranslationStyle.js";
import { resolvePageTranslationScope } from "common/scripts/pageTranslationScope.js";
import { normalizeProviders, resolveActiveProvider, resolveActiveModel } from "common/scripts/customProviderSettings.js";
class TranslatorManager {
    /**
     * @param {import("../../common/scripts/channel.js").default} channel Communication channel.
     */
    constructor(channel) {
        /**
         * @type {import("../../common/scripts/channel.js").default} Communication channel.
         */
        this.channel = channel;

        /**
         * @type {Promise<Void>} Initialize configurations.
         */
        this.config_loader = getOrSetDefaultSettings(
            ["languageSetting", "OtherSettings", "AIModel", "ApiKey", "TranslationService", "CustomModel", "CustomModelName", "CustomProviders", "ActiveProviderId"],
            DEFAULT_SETTINGS
        ).then((configs) => {
            // Init AI translator.
            this.AI_TRANSLATOR = new AITranslator();

            // Supported translators.
            this.TRANSLATORS = {
                AITrans: this.AI_TRANSLATOR,
            };

            // Translation language settings.
            this.LANGUAGE_SETTING = configs.languageSetting;

            // Other settings.
            this.OTHER_SETTINGS = configs.OtherSettings;

            // The default translator to use.
            this.DEFAULT_TRANSLATOR = "AITrans";

            // 服务模式与自定义模型相关状态
            this.SERVICE_MODE = configs.TranslationService || "free";
            this.CUSTOM_MODEL = !!configs.CustomModel;
            this.CUSTOM_MODEL_NAME = configs.CustomModelName || "";
            this.AI_MODEL = configs.AIModel;

            // 自定义服务商列表与当前选中项
            this.CUSTOM_PROVIDERS = normalizeProviders(configs.CustomProviders);
            this.ACTIVE_PROVIDER_ID = configs.ActiveProviderId || "";

            // 计算有效模型：自定义模式且勾选了自定义模型时，使用用户手填的模型名。
            // 兜底：免费模式或非自定义时若 AIModel 缺失，回退到预设模型首个，避免空模型被后续 setCurrentModel 静默 no-op。
            const fallbackModel = this.AI_TRANSLATOR.getAvailableModels()[0];
            const effectiveModel = (this.SERVICE_MODE === "custom" && this.CUSTOM_MODEL && this.CUSTOM_MODEL_NAME)
                ? this.CUSTOM_MODEL_NAME
                : (this.AI_MODEL || fallbackModel);

            // 设置模型、服务模式与 API Key
            this.AI_TRANSLATOR.setCurrentModel(effectiveModel);
            this.AI_TRANSLATOR.setServiceMode(this.SERVICE_MODE);
            this.AI_TRANSLATOR.setApiKey(configs.ApiKey || "");
            // provider 模式下模型取自服务商配置，这里必须把选中服务商推给翻译器
            this.applyCustomProvider();

            // 在配置加载完成后更新菜单
            this.updateTranslatePageMenu();
        });

        /**
         * Start to provide services and listen to event.
         */
        this.provideServices();
        this.listenToEvents();
    }

    /**
     * 把当前选中的自定义服务商推给翻译器。
     *
     * 只在「需要用到它」时才要求存在：其余模式（free / custom）选中的服务商为空是正常的，
     * 不能因此报错；provider 模式下若确实没有可用服务商，翻译器会在请求时抛出明确错误。
     *
     * 翻译器那边只认单个 `model`（translators 包不必知道「一个服务商可以有多个模型」），
     * 因此在这里解析出当前活动的那个再传进去。
     */
    applyCustomProvider() {
        const provider = resolveActiveProvider(this.CUSTOM_PROVIDERS, this.ACTIVE_PROVIDER_ID);
        this.AI_TRANSLATOR.setCustomProvider(
            provider ? { ...provider, model: resolveActiveModel(provider) } : null
        );
    }

    /**
     * Register service providers.
     *
     * This should be called for only once!
     */
    provideServices() {
        // Translate service for page popup.
        this.channel.provide("translate_in_popup", async (params) => {
            // Ensure that configurations have been initialized.
            await this.config_loader;
            
            let { text, sl, tl } = params;
            
            try {
                // 处理互译模式
                if (this.OTHER_SETTINGS.MutualTranslate) {
                    // 如果源语言是自动检测，先检测语言
                    if (sl === "auto") {
                        sl = await this.AI_TRANSLATOR.detect(text);
                        console.log('Popup detected source language:', sl);
                    }
                    
                    console.log('Popup current sl:', sl, 'current tl:', tl);
                    console.log('Popup MutualTranslate:', this.OTHER_SETTINGS.MutualTranslate);
                    
                    // 互译模式：根据检测到的源语言动态切换目标语言
                    if (sl === "zh-CN" || sl === "zh-TW") {
                        // 如果源语言是中文，目标语言切换为英文
                        tl = "en";
                        console.log('Popup switching to English, tl:', tl);
                    } else if (sl === "en") {
                        // 如果源语言是英文，目标语言切换为中文
                        tl = this.LANGUAGE_SETTING.tl;
                        console.log('Popup switching to Chinese, tl:', tl);
                    } else {
                        // 其他语言保持原有目标语言
                        console.log('Popup keeping original target language, tl:', tl);
                    }
                }
                
                console.log('Popup final translation languages - sl:', sl, 'tl:', tl);
                let result = await this.AI_TRANSLATOR.translate(text, sl, tl);
                return result;
            } catch (error) {
                throw error;
            }
        });

        // Translate service for selection.
        this.channel.provide("translate", async (params) => {
            // Ensure that configurations have been initialized.
            await this.config_loader;
            return this.translate(params.text, params.position);
        });

        // Get available AI models service.
        this.channel.provide("get_available_ai_models", () =>
            Promise.resolve(this.getAvailableAIModels())
        );
        
        // Update AI model service.
        this.channel.provide("update_ai_model", (detail) =>
            this.updateAIModel(detail.model)
        );

        // 测试自定义服务商连通性。
        // 收的是设置页当前的**草稿**配置（可能尚未保存），因此不能读 this.CUSTOM_PROVIDERS——
        // 否则用户改了地址点测试，测的还是旧值，是最容易让人误判的一种 bug。
        this.channel.provide("test_custom_provider", (params) => {
            const config = (params && params.config) || {};
            const sample = (params && params.sample) || undefined;
            return testProvider(config, sample);
        });

        // 拉取自定义服务商的模型列表（OpenAI 兼容的 GET /models）
        this.channel.provide("list_custom_provider_models", (params) =>
            fetchModels((params && params.config) || {})
        );

        // 划词结果框的「翻译来源」下拉所需的状态：当前服务模式 + 自定义服务商列表。
        // 结果框是内容脚本，拿不到后台内存里的 this.CUSTOM_PROVIDERS，必须由这里提供；
        // 顺带保证它看到的列表与后台实际使用的那份是同一个来源。
        this.channel.provide("get_translation_service_state", async () => {
            await this.config_loader;
            return {
                mode: this.SERVICE_MODE,
                activeId: this.ACTIVE_PROVIDER_ID,
                // 发完整结构（含 models / activeModel），让结果框不必依赖老数据迁移就能拿到
                // 正确的形状；**不发 apiKey**——内容脚本没有用到它的地方，不必扩大暴露面。
                providers: this.CUSTOM_PROVIDERS.map((provider) => ({
                    id: provider.id,
                    name: provider.name,
                    endpoint: provider.endpoint,
                    models: provider.models,
                    activeModel: provider.activeModel,
                })),
            };
        });

        // 从划词结果框切换当前使用的「服务商 + 模型」。
        // 只写 ActiveProviderId 与对应服务商的 activeModel：服务商与模型的增删改仍只在设置页进行。
        //
        // 为什么不另建一个顶层 ActiveModel：模型只对某个服务商有意义（同一个模型名在不同服务商下
        // 可能并不存在），把它挂在服务商上是唯一不会出现「A 的模型配给了 B」的结构。
        this.channel.provide("set_active_provider", (params) => {
            const id = (params && params.id) || "";
            const model = typeof (params && params.model) === "string" ? params.model.trim() : "";

            const onlySwitchProvider = () =>
                new Promise((resolve) => {
                    chrome.storage.sync.set({ ActiveProviderId: id }, () => resolve());
                });

            // 只切换服务商（老调用方，或没带模型）：不需要动服务商列表
            if (!model) return onlySwitchProvider();

            return new Promise((resolve) => {
                // 从 storage **重新读一份**再改，不用内存里的 this.CUSTOM_PROVIDERS：
                // 后者可能在 onChanged 事件到达之前就已经过期（用户刚在设置页保存过），
                // 拿它整份写回会把设置页刚保存的内容覆盖掉——静默丢数据，最难排查。
                chrome.storage.sync.get(["CustomProviders"], (result) => {
                    const list = normalizeProviders(result && result.CustomProviders);
                    const target = list.find((provider) => provider.id === id);

                    // 只接受该服务商**确实拥有**的模型：结果框传来的 key 可能因为并发编辑而过期，
                    // 写进一个不存在的模型会让之后每次翻译都失败。
                    if (!target || !Array.isArray(target.models) || !target.models.includes(model)) {
                        onlySwitchProvider().then(resolve);
                        return;
                    }

                    target.activeModel = model;
                    chrome.storage.sync.set(
                        { ActiveProviderId: id, CustomProviders: list },
                        () => resolve()
                    );
                });
            });
        });

        // 配置加载完成后已经在构造函数中更新了菜单，无需重复调用
    }

    /**
     * Register event listeners.
     *
     * This should be called for only once!
     */
    listenToEvents() {
        /**
         * Update config cache on config changed.
         */
        chrome.storage.onChanged.addListener(
            (async (changes, area) => {
                if (area === "sync") {
                    // Ensure that configurations have been initialized.
                    await this.config_loader;

                    if (changes["languageSetting"]) {
                        this.LANGUAGE_SETTING = changes["languageSetting"].newValue;
                    }
                    
                    if (changes["OtherSettings"]) {
                        this.OTHER_SETTINGS = changes["OtherSettings"].newValue;
                    }
                    
                    if (changes["AIModel"]) {
                        this.AI_MODEL = changes["AIModel"].newValue;
                    }

                    if (changes["TranslationService"]) {
                        this.SERVICE_MODE = changes["TranslationService"].newValue || "free";
                        // Update the translation service mode for the translator.
                        this.AI_TRANSLATOR.setServiceMode(this.SERVICE_MODE);
                    }

                    if (changes["CustomModel"]) {
                        this.CUSTOM_MODEL = !!changes["CustomModel"].newValue;
                    }

                    if (changes["CustomModelName"]) {
                        this.CUSTOM_MODEL_NAME = changes["CustomModelName"].newValue || "";
                    }

                    if (changes["CustomProviders"]) {
                        this.CUSTOM_PROVIDERS = normalizeProviders(changes["CustomProviders"].newValue);
                    }

                    if (changes["ActiveProviderId"]) {
                        this.ACTIVE_PROVIDER_ID = changes["ActiveProviderId"].newValue || "";
                    }

                    // 服务商列表 / 选中项 / 服务模式任一变化都要重推配置，
                    // 否则用户在设置页新增服务商后不重载扩展仍然用的是旧配置。
                    if (changes["CustomProviders"] || changes["ActiveProviderId"] || changes["TranslationService"]) {
                        this.applyCustomProvider();
                    }

                    if (changes["ApiKey"]) {
                        // Update the api key for the translator (custom mode only).
                        this.AI_TRANSLATOR.setApiKey(changes["ApiKey"].newValue || "");
                    }

                    // 任一影响有效模型的因素变化，重新计算并设置
                    if (changes["AIModel"] || changes["TranslationService"] || changes["CustomModel"] || changes["CustomModelName"]) {
                        const fallbackModel = this.AI_TRANSLATOR.getAvailableModels()[0];
                        const effectiveModel = (this.SERVICE_MODE === "custom" && this.CUSTOM_MODEL && this.CUSTOM_MODEL_NAME)
                            ? this.CUSTOM_MODEL_NAME
                            : (this.AI_MODEL || fallbackModel);
                        this.AI_TRANSLATOR.setCurrentModel(effectiveModel);
                    }
                }
            }).bind(this)
        );
    }

    /**
     * get the id of the current tab
     * if the current tab can't display the result panel
     * open a notice page to display the result and explain why the page shows
     * @returns the tab id. If tabId===-1, the user is setting the file URLs access permission and nothing should be done.
     */
    async getCurrentTabId() {
        let tabId = -1;
        const tabs = await promiseTabs.query({ active: true, currentWindow: true });
        tabId = tabs[0].id;

        // to test whether the current tab can receive message(display results)
        await this.channel.requestToTab(tabId, "check_availability").catch(async () => {
            const shouldOpenNoticePage = await new Promise((resolve) => {
                // The page is a local file page
                if (/^file:\/\.*/.test(tabs[0].url)) {
                    chrome.extension.isAllowedFileSchemeAccess((allowed) => {
                        if (!allowed && confirm(chrome.i18n.getMessage("PermissionRemind"))) {
                            chrome.tabs.create({
                                url: `chrome://extensions/?id=${chrome.runtime.id}`,
                            });
                            resolve(false);
                        } else resolve(true);
                    });
                } else resolve(true);
            });
            if (!shouldOpenNoticePage) {
                tabId = -1;
                return;
            }
            /**
             * the current tab can't display the result panel
             * so we open a notice page to display the result and explain why this page shows
             */
            const noticePageUrl = chrome.runtime.getURL("content/notice/notice.html");
            // get the tab id of an existing notice page
            try {
                const tab = (await promiseTabs.query({ url: noticePageUrl }))[0];
                // jump to the existed page
                chrome.tabs.highlight({
                    tabs: tab.index,
                });
                tabId = tab.id;
            } catch (error) {
                // create a new notice page
                const tab = await promiseTabs.create({
                    url: noticePageUrl,
                    active: true,
                });
                // wait for browser to open a new page
                await delayPromise(200);
                tabId = tab.id;
            }
        });
        return tabId;
    }

    /**
     *
     * 检测给定文本的语言。
     *
     * @param {string} text 需要检测的文本
     *
     * @returns {Promise<String>} detected language Promise
     */
    async detect(text) {
        // Ensure that configurations have been initialized.
        await this.config_loader;

        return this.AI_TRANSLATOR.detect(text);
    }

    /**
     *
     * This is a translation client function
     * 1. get language settings
     * 2. if source language is "auto", use normal translation mode
     * 3. else use mutual translation mode(auto translate from both sides)
     * 4. send request, get result
     *
     * @param {String} text original text to be translated
     * @param {Array<Number>} position position of the text
     * @param {Number} selectionHeight height of the selected text
     *
     * @returns {Promise<void>} translate finished Promise
     */
    async translate(text, position, selectionHeight = 0) {
        // Ensure that configurations have been initialized.
        await this.config_loader;

        // get current tab id
        const currentTabId = await this.getCurrentTabId();
        if (currentTabId === -1) return;

        /**
         * Get current time as timestamp.
         *
         * Timestamp is used for preventing disordered translating message to disturb user.
         *
         * Every translating request has a unique timestamp and every message from that translating
         * request will be assigned with the timestamp. About usage of the timestamp, please refer
         * to display.js.
         */
        let timestamp = new Date().getTime();

        // Inform current tab translating started.
        this.channel.emitToTabs(currentTabId, "start_translating", {
            text,
            position,
            selectionHeight,
            timestamp,
        });

        let sl = this.LANGUAGE_SETTING.sl,
            tl = this.LANGUAGE_SETTING.tl;
        let originalTl = tl;

        try {
            // 处理互译模式
            if (this.OTHER_SETTINGS.MutualTranslate) {
                // 如果源语言是自动检测，先检测语言
                if (sl === "auto") {
                    sl = await this.AI_TRANSLATOR.detect(text);
                    console.log('Detected source language:', sl);
                }
                
                console.log('Current sl:', sl, 'current tl:', tl);
                console.log('MutualTranslate:', this.OTHER_SETTINGS.MutualTranslate);
                
                // 互译模式：根据检测到的源语言动态切换目标语言
                if (sl === "zh-CN" || sl === "zh-TW") {
                    // 如果源语言是中文，目标语言切换为英文
                    tl = "en";
                    console.log('Switching to English, tl:', tl);
                } else if (sl === "en") {
                    // 如果源语言是英文，目标语言切换为中文
                    tl = this.LANGUAGE_SETTING.tl;
                    console.log('Switching to Chinese, tl:', tl);
                } else {
                    // 其他语言保持原有目标语言
                    console.log('Keeping original target language, tl:', tl);
                }
            }

            console.log('Final translation languages - sl:', sl, 'tl:', tl);
            // Do translate.
            let result = await this.AI_TRANSLATOR.translate(text, sl, tl);
            result.sourceLanguage = sl;
            result.targetLanguage = tl;

            // Send translating result to current tab.
            this.channel.emitToTabs(currentTabId, "translating_finished", {
                timestamp,
                ...result,
            });
        } catch (error) {
            // Inform current tab translating failed.
            // Error 对象经消息通道 JSON 序列化后仅剩 message，需在此构造结构化错误，
            // 并按瞬时特征分类：限流/网关错误（中继会把上游限流透传成 502）视为模型繁忙，
            // 网络层错误视为网络异常，其余按接口错误展示。
            const message = String(
                (error && (error.message || error.errorMsg)) || error
            );
            let errorType = "API_ERR";
            if (/transient|429|rate\s*limit|status code 5\d{2}/i.test(message)) {
                errorType = "MODEL_BUSY";
            } else if (/network|timeout|NET_ERR|ECONN|failed to fetch/i.test(message)) {
                errorType = "NET_ERR";
            }
            this.channel.emitToTabs(currentTabId, "translating_error", {
                error: {
                    errorType: errorType,
                    errorCode: 0,
                    errorMsg: message,
                },
                timestamp,
            });
        }
    }

    /**
     * Get available AI models.
     *
     * @returns {Array<string>} available AI models.
     */
    getAvailableAIModels() {
        return this.AI_TRANSLATOR.getAvailableModels();
    }
    
    /**
     * Update AI model.
     *
     * @param {string} model the new AI model to use.
     *
     * @returns {Promise<void>} update finished promise.
     */
    updateAIModel(model) {
        return new Promise((resolve) => {
            chrome.storage.sync.set({ AIModel: model }, () => {
                resolve();
            });
        });
    }
    
    /**
     * Update the "translate page" context menu.
     *
     * 定制：菜单不再附带模型二级选项，点击后由 translatePage 使用设置中选定的模型。
     */
    updateTranslatePageMenu() {
        // 定制：不再需要模型列表，点击菜单直接使用设置中选定的模型
        
        // 确保 chrome.contextMenus 可用时才创建菜单
        if (chrome.contextMenus) {
            // 先移除旧菜单，避免重复创建
            try {
                chrome.contextMenus.removeAll(() => {
                    // 移除所有菜单后重新创建
                    // 重新创建选择翻译菜单
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
                    
                    // 创建翻译此页主菜单
                    // 定制：不再创建模型子菜单，点击该项直接使用设置中选择的模型
                    chrome.contextMenus.create({
                        id: "translate_page",
                        title: chrome.i18n.getMessage("TranslatePage"),
                        contexts: ["page"],
                        enabled: true,
                    });
                });
            } catch (error) {
                console.error('lightrans: Error updating translate page menu:', error);
            }
        }
    }
}

/**
 * 使用指定的AI模型翻译当前网页。
 *
 * @param {import("../../common/scripts/channel.js").default} channel Communication channel.
 * @param {string} [model] The AI model to use for translation. If not provided, uses the default model.
 */
function translatePage(channel, model) {
    console.log('lightrans: translatePage function called with model:', model);
    // 读取页面翻译偏好：显示模式（原文/译文/对照）、对照模式下的译文样式、翻译范围
    getOrSetDefaultSettings(
        ["PageTranslationDisplayMode", "PageTranslationStyle", "PageTranslationScope"],
        DEFAULT_SETTINGS
    ).then((allSettings) => {
        const pageModeParam = (allSettings && allSettings.PageTranslationDisplayMode) || "translated";
        // 译文样式在注入前解析成 CSS 文本：注入到页面的函数会被序列化，无法 import 模块
        const pageStyleCss = resolvePageTranslationStyleCss(
            allSettings && allSettings.PageTranslationStyle
        );
        // 翻译范围同理：解析成普通对象后随 args 传入，注入函数里不读设置
        const pageScopeParam = resolvePageTranslationScope(
            allSettings && allSettings.PageTranslationScope
        );
        // 获取当前标签页
        promiseTabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const tabId = tabs[0].id;
        console.log('lightrans: Current tab id:', tabId);
        
        // 注入网页翻译脚本，使用Function构造函数安全传递参数
        const modelParam = model || "default";
        
        // 使用 chrome.scripting.executeScript 注入脚本（MV3 已移除 chrome.tabs.executeScript）
        // 把原内联脚本重构成可序列化的函数，通过 args 传入 pageMode、model、译文样式与翻译范围
        const injectPageTranslate = (pageMode, model, styleCss, pageScope) => {
            console.log('lightrans: Page translate script injected');

            // 页面翻译显示模式：original(原文) / translated(译文) / bilingual(对照)
            // styleCss：对照模式下插入页面的译文样式，由 background 预先解析好传入
            // pageScope：翻译范围开关（跳过隐藏内容 / 吸顶悬浮层 / 站点框架），同样由 background 传入

            // 检查document.body是否存在
            if (!document.body) {
                        console.error('lightrans: document.body is not available');
                        return;
                    }

                    // 页面翻译工具条的标题元素引用（翻译完成时更新）
                    let bannerTitleEl = null;

                    // 对照模式下插入的译文 span 集合，便于切换模式时移除
                    const insertedSpans = [];
                    
                    // 存储原始文本内容，用于翻译和恢复
                    window.lightransOriginalTextNodes = [];
                    
                    // ===== 翻译范围（轻量档）=====
                    // 目标：把站点框架（页眉、导航、侧栏、吸顶栏、隐藏内容）排除在翻译之外，
                    // 否则页面顶部与非正文区域会被翻译得杂乱。
                    // 只做「排除」，不改动收集后的索引体系（allTexts / textIndices /
                    // lightransOriginalTextNodes / 视口排序），因此与显示模式、恢复原文完全正交。
                    const scopeOn = {
                        invisible: !pageScope || pageScope.SkipInvisible !== false,
                        sticky: !pageScope || pageScope.SkipSticky !== false,
                        chrome: !pageScope || pageScope.SkipSemanticChrome !== false,
                    };

                    // getComputedStyle 很贵，而大页面上文本节点有几千个 —— 按元素缓存，
                    // 保证每个元素最多只取一次计算样式。
                    const styleCache = new WeakMap();
                    function styleOf(el) {
                        let s = styleCache.get(el);
                        if (!s) {
                            s = window.getComputedStyle(el);
                            styleCache.set(el, s);
                        }
                        return s;
                    }

                    // 语义标签 + ARIA 角色：站点框架的规范写法
                    const CHROME_SELECTOR = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="menu"], [role="menubar"], [role="search"], [role="tablist"], [role="toolbar"], [role="dialog"], [role="alertdialog"]';
                    // class/id 关键词：要求词边界，避免误伤 article-header / news-header 这类命名
                    // 因此这里刻意不收 header，站点页眉由上面的语义选择器负责
                    const CHROME_TOKEN_RE = /(^|[-_ ])(nav|navbar|navigation|mainnav|subnav|topnav|topbar|menubar|menu|sidebar|breadcrumb|breadcrumbs|toolbar|pagination|pager|copyright)([-_ ]|$)/i;

                    function isSemanticChrome(el) {
                        const hit = el.closest ? el.closest(CHROME_SELECTOR) : null;
                        if (hit) {
                            // 带 role 的一律算框架
                            if (hit.hasAttribute && hit.hasAttribute("role")) return true;
                            // 但 <header>/<footer>/<nav>/<aside> 落在正文内部时通常是内容本身
                            // （文章标题区、文内目录、拉引），不算站点框架。
                            // <aside> 例外：<main> 里的 aside 基本都还是侧栏，只有 article 内的才算内容。
                            const contentGuard =
                                hit.tagName === "ASIDE" ? "article" : 'article, main, [role="main"]';
                            return !(hit.closest && hit.closest(contentGuard));
                        }
                        // 中文站点普遍是 div + 类名、没有语义标签，退回关键词匹配
                        let cur = el;
                        let depth = 0;
                        while (cur && cur !== document.body && depth < 12) {
                            const cls = typeof cur.className === "string" ? cur.className : "";
                            const sig = cls + " " + (cur.id || "");
                            if (sig.trim() && CHROME_TOKEN_RE.test(sig)) return true;
                            cur = cur.parentElement;
                            depth++;
                        }
                        return false;
                    }

                    // 不可见内容：翻译了也看不到，纯属浪费配额
                    function isInvisible(el) {
                        if (typeof el.checkVisibility === "function") {
                            try {
                                // 一次调用即可判断祖先链上的 display / visibility / opacity
                                return !el.checkVisibility({
                                    checkOpacity: true,
                                    checkVisibilityCSS: true,
                                });
                            } catch (e) {
                                // 旧实现的 checkVisibility 不认这些选项，退回手动判断
                            }
                        }
                        let cur = el;
                        while (cur && cur.nodeType === 1) {
                            const st = styleOf(cur);
                            if (
                                st.display === "none" ||
                                st.visibility === "hidden" ||
                                st.visibility === "collapse"
                            ) {
                                return true;
                            }
                            if (parseFloat(st.opacity) === 0) return true;
                            cur = cur.parentElement;
                        }
                        return false;
                    }

                    // 吸顶导航 / 悬浮层。必须排除「占满视口的固定容器」——
                    // 有些站点把整页装在一个 position:fixed 的滚动容器里，一律过滤会导致整页不翻译。
                    function isFixedOverlay(el) {
                        let cur = el;
                        let depth = 0;
                        while (cur && cur !== document.body && depth < 15) {
                            const pos = styleOf(cur).position;
                            if (pos === "fixed" || pos === "sticky") {
                                try {
                                    const rect = cur.getBoundingClientRect();
                                    const vw = window.innerWidth || 1;
                                    const vh = window.innerHeight || 1;
                                    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
                                    return area / (vw * vh) < 0.6;
                                } catch (e) {
                                    return true;
                                }
                            }
                            cur = cur.parentElement;
                            depth++;
                        }
                        return false;
                    }

                    // 判定结果按元素缓存：同一个父元素下的多个文本节点（如一个 <p> 里的若干段）
                    // 只算一次；祖先一旦被判定为排除，其后代直接继承，不必重复向上遍历
                    // （对三个开关都成立：祖先在框架/隐藏/吸顶容器里，后代必然也在）。
                    const scopeCache = new WeakMap();
                    function isOutOfScope(el) {
                        if (!el || el.nodeType !== 1 || el === document.body) return false;
                        const cached = scopeCache.get(el);
                        if (cached !== undefined) return cached;

                        const parent = el.parentElement;
                        let result;
                        if (parent && parent !== document.body && isOutOfScope(parent)) {
                            result = true;
                        } else {
                            result =
                                (scopeOn.chrome && isSemanticChrome(el)) ||
                                (scopeOn.invisible && isInvisible(el)) ||
                                (scopeOn.sticky && isFixedOverlay(el));
                        }
                        scopeCache.set(el, result);
                        return result;
                    }

                    // 获取网页中所有文本节点
                    function getAllTextNodes(root) {
                        const textNodes = [];
                        try {
                            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                                acceptNode: function(node) {
                                    // 过滤掉空文本节点和特定元素内的文本
                                    if (!node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
                                    if (node.parentNode.closest('script, style, noscript, iframe, svg, canvas, input, textarea, select, img, picture, video, audio, embed, object')) {
                                        return NodeFilter.FILTER_SKIP;
                                    }
                                    // 再按翻译范围排除站点框架 / 隐藏内容 / 吸顶悬浮层
                                    if (isOutOfScope(node.parentElement)) return NodeFilter.FILTER_SKIP;
                                    return NodeFilter.FILTER_ACCEPT;
                                }
                            }, false);
                            let node;
                            while ((node = walker.nextNode())) {
                                textNodes.push(node);
                                // 存储原始文本内容
                                window.lightransOriginalTextNodes.push({
                                    node: node,
                                    originalText: node.nodeValue
                                });
                            }
                        } catch (error) {
                            console.error('lightrans: Error in getAllTextNodes:', error);
                        }
                        return textNodes;
                    }
                    
                    // 获取网页内容
                    const textNodes = getAllTextNodes(document.body);
                    console.log('lightrans: Found text nodes:', textNodes.length);
                    
                    // 收集所有需要翻译的文本
                    const allTexts = [];
                    const textIndices = []; // 记录原始索引与收集的文本索引的映射
                    const textMap = new Map(); // 用于去重
                    
                    textNodes.forEach((node, index) => {
                        const text = node.nodeValue;
                        // 翻译所有非空文本，去掉长度限制
                        if (text.trim()) {
                            if (!textMap.has(text)) {
                                textMap.set(text, allTexts.length);
                                allTexts.push(text);
                            }
                            textIndices.push(textMap.get(text));
                        } else {
                            textIndices.push(-1); // 表示不需要翻译
                        }
                    });
                    
                    console.log('lightrans: Total texts to translate:', allTexts.length);
                    
                    // ===== 翻译调度参数 =====
                    // 短文本阈值：不超过该字符数且无换行的文本（菜单项、按钮、链接等）参与批量合并
                    const SHORT_TEXT_LIMIT = 120;
                    // 每批最多合并的短文本条数
                    const BATCH_MAX_COUNT = 25;
                    // 每批合并后的总字符上限（控制输出规模，避免译文被 max_tokens 截断）
                    const BATCH_MAX_CHARS = 1000;
                    // 自适应并发：初始 / 上限 / 下限。初始保守起步（免费中继共享配额，
                    // 瞬时 8 并发批量易打满 TPM，上游限流会被中继透传成 502），
                    // 持续成功后自动爬升到上限；配额升级后可适当调高初始值。
                    const INITIAL_PARALLEL = 4;
                    const MAX_PARALLEL = 10;
                    const MIN_PARALLEL = 1;
                    // 连续成功多少个批次后并发 +1（恢复探测）
                    const SUCCESS_STREAK_TO_RECOVER = 15;
                    // 限流退避：起始 1s 指数增长，上限 30s；单批退避重排超过该次数则放弃（保留原文）
                    const BACKOFF_BASE_MS = 1000;
                    const BACKOFF_MAX_MS = 30000;
                    const MAX_RATE_LIMIT_RETRIES = 8;

                    const translatedTexts = new Array(allTexts.length);
                    let totalTranslated = 0;
                    let totalReplaced = 0;

                    // ===== 视口优先：首屏文本先翻译，视口外（长页面尾部）后翻译 =====
                    const textInViewport = new Array(allTexts.length).fill(false);
                    textNodes.forEach((node, index) => {
                        const textIndex = textIndices[index];
                        if (textIndex >= 0 && !textInViewport[textIndex] && node.parentElement) {
                            const rect = node.parentElement.getBoundingClientRect();
                            if (rect.top < window.innerHeight && rect.bottom > 0) {
                                textInViewport[textIndex] = true;
                            }
                        }
                    });
                    const sendOrder = [];
                    for (let i = 0; i < allTexts.length; i++) {
                        if (textInViewport[i]) sendOrder.push(i);
                    }
                    for (let i = 0; i < allTexts.length; i++) {
                        if (!textInViewport[i]) sendOrder.push(i);
                    }

                    // ===== 任务打包：按发送顺序把连续短文本合并为批量任务（一次请求），长文本独立成任务 =====
                    const tasks = [];
                    let currentBatch = [];
                    let currentBatchChars = 0;

                    function flushBatch() {
                        if (currentBatch.length > 0) {
                            tasks.push({ indices: currentBatch, rateLimitRetries: 0 });
                            currentBatch = [];
                            currentBatchChars = 0;
                        }
                    }

                    sendOrder.forEach((textIndex) => {
                        const text = allTexts[textIndex];
                        const trimmed = text.trim();
                        const isShort = trimmed.length <= SHORT_TEXT_LIMIT && !/\n/.test(trimmed);
                        if (isShort) {
                            // 达到条数或字符上限时先落批
                            if (currentBatch.length >= BATCH_MAX_COUNT || currentBatchChars + text.length > BATCH_MAX_CHARS) {
                                flushBatch();
                            }
                            currentBatch.push(textIndex);
                            currentBatchChars += text.length;
                        } else {
                            // 长文本独立成任务，不打断也不并入当前批
                            flushBatch();
                            tasks.push({ indices: [textIndex], rateLimitRetries: 0 });
                        }
                    });
                    flushBatch();

                    console.log('lightrans: Packed', allTexts.length, 'texts into', tasks.length, 'tasks (viewport first:', textInViewport.filter(Boolean).length, 'texts)');
                    
                    // 当前显示模式。工具栏上的按钮可以随时切换，因此它必须是可变的；
                    // pageMode 只是注入时的初始值，此后所有渲染判断一律读 currentMode，
                    // 否则「翻译进行中切换模式」会被后续批次按旧模式覆盖回去。
                    let currentMode = pageMode;

                    // 判断某个节点是否已是本扩展插入的对照译文 span
                    function isBilingualSpan(el) {
                        return !!(el && el.nodeType === 1 && el.classList &&
                            el.classList.contains('lightrans-bilingual'));
                    }

                    // 构造对照模式下插入页面的译文 span（样式由 background 预先算好传入）
                    function makeBilingualSpan(text) {
                        const span = document.createElement('span');
                        span.className = 'lightrans-bilingual';
                        span.textContent = text;
                        span.style.cssText = styleCss || 'display:block;margin:2px 0 6px;padding:2px 6px;background:#f5f7fa;border-left:3px solid #2f6bff;color:#3a4252;font-size:0.92em;line-height:1.5;border-radius:4px;';
                        return span;
                    }

                    // 替换已翻译的文本节点
                    function replaceTranslatedNodes() {
                        let replacedCount = 0;

                        // 替换所有已翻译的文本节点
                        textNodes.forEach((node, index) => {
                            const textIndex = textIndices[index];
                            if (textIndex >= 0 && translatedTexts[textIndex]) {
                                // 始终缓存译文，供后续切换显示模式使用
                                if (window.lightransOriginalTextNodes && window.lightransOriginalTextNodes[index]) {
                                    window.lightransOriginalTextNodes[index].translatedText = translatedTexts[textIndex];
                                }
                                if (currentMode === 'translated') {
                                    // 「译文」模式：就地替换文本节点
                                    if (node.nodeValue !== translatedTexts[textIndex]) {
                                        node.nodeValue = translatedTexts[textIndex];
                                        replacedCount++;
                                        totalReplaced++;
                                    }
                                } else if (
                                    currentMode === 'bilingual' &&
                                    node.parentNode &&
                                    !isBilingualSpan(node.nextSibling)
                                ) {
                                    // 「对照」模式：原文保持不动，在它后面补一段译文
                                    const span = makeBilingualSpan(translatedTexts[textIndex]);
                                    node.parentNode.insertBefore(span, node.nextSibling);
                                    insertedSpans.push(span);
                                    replacedCount++;
                                }
                                // 「原文」模式：什么都不做，节点保持原样
                            }
                        });

                        if (replacedCount > 0) {
                            console.log('lightrans: Replaced', replacedCount, 'nodes in this update, total replaced:', totalReplaced);
                        }
                    }
                    
                    // ===== 自适应并发调度器 =====
                    let pendingTasks = tasks.slice();
                    let inFlight = 0;
                    let currentParallel = INITIAL_PARALLEL;
                    let successStreak = 0;
                    let backoffMs = BACKOFF_BASE_MS;
                    let backoffUntil = 0;

                    function pump() {
                        if (Date.now() < backoffUntil || pendingTasks.length === 0) return;
                        while (inFlight < currentParallel && pendingTasks.length > 0) {
                            const task = pendingTasks.shift();
                            inFlight++;
                            sendBatchRequest(task);
                        }
                    }

                    // 限流：并发减半 + 指数退避，期间 pump 不再发新请求
                    function enterBackoff() {
                        backoffUntil = Date.now() + backoffMs;
                        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
                        currentParallel = Math.max(MIN_PARALLEL, Math.floor(currentParallel / 2));
                        successStreak = 0;
                    }

                    // 持续成功：逐步恢复并发并重置退避时长
                    function onBatchSuccess() {
                        successStreak++;
                        if (successStreak >= SUCCESS_STREAK_TO_RECOVER && currentParallel < MAX_PARALLEL) {
                            currentParallel++;
                            successStreak = 0;
                        }
                        backoffMs = BACKOFF_BASE_MS;
                    }

                    function finishTask() {
                        // 批量模式下任务数远少于文本数，每任务渲染一次即可
                        replaceTranslatedNodes();
                        if (totalTranslated >= allTexts.length) {
                            console.log('lightrans: All texts translated, total replaced:', totalReplaced, 'nodes');
                            if (bannerTitleEl) bannerTitleEl.textContent = 'Lightrans 已翻译此页';
                            // 全部完成后按「当前」模式做一次完整重渲染，统一补齐各节点的最终状态。
                            // 注意用 currentMode 而不是注入时的 pageMode，否则用户中途切到「对照」
                            // 会被这一句按初始模式（默认 translated）覆盖回去。
                            applyMode(currentMode);
                        }
                    }

                    // 处理一批翻译结果：按任务内的索引一一回填
                    function handleTranslationResult(task, translatedBatch) {
                        task.indices.forEach((textIndex, i) => {
                            translatedTexts[textIndex] = translatedBatch[i];
                        });
                        totalTranslated += task.indices.length;
                        finishTask();
                    }

                    // 兜底：重试耗尽或异常时保留原文并推进进度，避免整体卡死
                    function handleTranslationFallback(task) {
                        task.indices.forEach((textIndex) => {
                            if (translatedTexts[textIndex] == null) {
                                translatedTexts[textIndex] = allTexts[textIndex];
                            }
                        });
                        totalTranslated += task.indices.length;
                        finishTask();
                    }

                    // 发送一批翻译请求（单个长文本或合并的短文本批）
                    function sendBatchRequest(task) {
                        const texts = task.indices.map(i => allTexts[i]);
                        chrome.runtime.sendMessage({
                            type: 'TRANSLATE_PAGE_CONTENT',
                            content: {
                                texts: texts
                            },
                            model: model
                        }, (response) => {
                            inFlight--;

                            if (chrome.runtime.lastError) {
                                console.error('lightrans: sendMessage error:', chrome.runtime.lastError);
                                handleTranslationFallback(task);
                                pump();
                                return;
                            }

                            if (response && response.rateLimited) {
                                task.rateLimitRetries++;
                                if (task.rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
                                    console.warn('lightrans: Batch rate-limited too many times, keeping original text');
                                    handleTranslationFallback(task);
                                } else {
                                    console.warn('lightrans: Rate limited, backing off', backoffMs, 'ms (parallel:', currentParallel, ')');
                                    enterBackoff();
                                    pendingTasks.unshift(task); // 本批重新排队，退避结束后重发
                                }
                                pump();
                                return;
                            }

                            if (response && response.translatedContent && response.translatedContent.texts) {
                                onBatchSuccess();
                                handleTranslationResult(task, response.translatedContent.texts);
                            } else {
                                console.error('lightrans: Translation failed for batch, keeping original text', response && response.error);
                                handleTranslationFallback(task);
                            }
                            pump();
                        });
                    }

                    // 开始调度
                    console.log('lightrans: Starting scheduled translation, total texts:', allTexts.length);
                    pump();

                    // 定时兜底驱动：覆盖退避到期后无事件触发的场景
                    const interval = setInterval(() => {
                        if (totalTranslated >= allTexts.length) {
                            clearInterval(interval);
                            return;
                        }
                        pump();
                    }, 300);

                    // 根据显示模式渲染页面：原文 / 译文 / 对照
                    function applyMode(mode) {
                        // 记住当前模式：工具栏点击与结束时的最终渲染都经这里，读同一个来源
                        currentMode = mode;
                        const originals = window.lightransOriginalTextNodes || [];
                        // 先清除已插入的对照译文 span
                        insertedSpans.forEach((sp) => {
                            if (sp.parentNode) sp.parentNode.removeChild(sp);
                        });
                        insertedSpans.length = 0;

                        if (mode === 'bilingual') {
                            originals.forEach((item) => {
                                const node = item && item.node;
                                if (!node) return;
                                node.nodeValue = item.originalText;
                                if (item.translatedText && node.parentNode) {
                                    const span = makeBilingualSpan(item.translatedText);
                                    node.parentNode.insertBefore(span, node.nextSibling);
                                    insertedSpans.push(span);
                                }
                            });
                        } else if (mode === 'original') {
                            originals.forEach((item) => {
                                if (item && item.node && item.originalText !== undefined) {
                                    item.node.nodeValue = item.originalText;
                                }
                            });
                        } else {
                            // translated
                            originals.forEach((item) => {
                                if (item && item.node && item.translatedText) {
                                    item.node.nodeValue = item.translatedText;
                                }
                            });
                        }
                    }

                    // 创建页面翻译工具条：显示原网页 / 显示译文 / 对照 / 关闭
                    function createBanner() {
                        if (document.getElementById('lightrans-page-banner')) return;
                        const banner = document.createElement('div');
                        banner.id = 'lightrans-page-banner';
                        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:10px;height:40px;padding:0 14px;background:#ffffff;color:#1f2430;font:14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 1px 6px rgba(0,0,0,0.18);box-sizing:border-box;';

                        const title = document.createElement('span');
                        title.textContent = 'Lightrans 翻译中…';
                        title.style.cssText = 'font-weight:600;white-space:nowrap;';
                        banner.appendChild(title);
                        bannerTitleEl = title;

                        const spacer = document.createElement('span');
                        spacer.style.cssText = 'flex:1;';
                        banner.appendChild(spacer);

                        function makeBtn(label) {
                            const b = document.createElement('button');
                            b.textContent = label;
                            b.style.cssText = 'cursor:pointer;border:1px solid #d0d5dd;background:#f5f7fa;color:#1f2430;border-radius:6px;padding:5px 10px;font:13px/1 system-ui,sans-serif;';
                            b.onmouseenter = () => { b.style.background = '#e9edf2'; };
                            b.onmouseleave = () => { b.style.background = '#f5f7fa'; };
                            return b;
                        }

                        const btnOriginal = makeBtn('显示原网页');
                        const btnTrans = makeBtn('显示译文');
                        const btnBilingual = makeBtn('对照');
                        const btnClose = makeBtn('✕');
                        btnClose.style.cssText += 'font-size:15px;line-height:1;padding:3px 9px;';

                        banner.appendChild(btnOriginal);
                        banner.appendChild(btnTrans);
                        banner.appendChild(btnBilingual);
                        banner.appendChild(btnClose);
                        document.body.appendChild(banner);

                        // 将页面主体下移，避免被工具条遮挡
                        document.body.style.marginTop = '40px';

                        btnOriginal.addEventListener('click', () => {
                            applyMode('original');
                        });

                        btnTrans.addEventListener('click', () => {
                            applyMode('translated');
                        });

                        btnBilingual.addEventListener('click', () => {
                            applyMode('bilingual');
                        });

                        btnClose.addEventListener('click', () => {
                            if (banner.parentNode) banner.parentNode.removeChild(banner);
                            document.body.style.marginTop = '';
                        });
                    }

                    createBanner();
                    if (allTexts.length === 0 && bannerTitleEl) {
                        bannerTitleEl.textContent = 'Lightrans 已翻译此页';
                    }
            };

            chrome.scripting.executeScript(
                { target: { tabId }, func: injectPageTranslate, args: [pageModeParam, modelParam, pageStyleCss, pageScopeParam] },
                (result) => {
            if (chrome.runtime.lastError) {
                log(`Chrome runtime error: ${chrome.runtime.lastError}`);
                log(`Detail: ${result}`);
                console.error('lightrans: executeScript error:', chrome.runtime.lastError);
            } else {
                console.log('lightrans: Script executed successfully, result:', result);
                channel.emitToTabs(tabId, "start_page_translate", { translator: "aitrans", model: model });
            }
        });
    });
    }).catch(error => {
        console.error('lightrans: Error in translatePage:', error);
    });
}

export { TranslatorManager, translatePage };
