import Channel from "common/scripts/channel.js";
import { i18nHTML } from "common/scripts/common.js";
import { DEFAULT_SETTINGS, getOrSetDefaultSettings } from "common/scripts/settings.js";
import { normalizeProviders } from "common/scripts/customProviderSettings.js";

/**
 * Communication channel.
 */
const channel = new Channel();

/**
 * 初始化设置列表
 */
window.onload = () => {
    i18nHTML();

    /**
     * 初始化AI模型下拉菜单
     */
    getOrSetDefaultSettings(["AIModel"], DEFAULT_SETTINGS).then(
        async (result) => {
            let defaultAIModel = result.AIModel;
            
            // 获取可用的AI模型
            const availableAIModels = await channel.request("get_available_ai_models", {});
            
            // 初始化AI模型下拉菜单
            const aiModelSelect = document.getElementById("ai-model");
            
            // 移除已有的选项
            aiModelSelect.innerHTML = "";
            
            // 添加可用的AI模型
            for (let model of availableAIModels) {
                const option = document.createElement("option");
                option.value = model;
                option.textContent = model;
                if (model === defaultAIModel) {
                    option.selected = true;
                }
                aiModelSelect.appendChild(option);
            }
        }
    );

    /**
     * initiate and update settings
     * attribute "setting-type": indicate the setting type of one option
     * attribute "setting-path": indicate the nested setting path. used to locate the path of one setting item in chrome storage
     */
    getOrSetDefaultSettings(undefined, DEFAULT_SETTINGS).then((result) => {
        let inputElements = document.getElementsByTagName("input");
        const selectElements = document.querySelectorAll("select[setting-type='select']");
        for (let element of [...inputElements, ...selectElements]) {
            // 跳过没有 setting-path 的元素：它们不属于声明式绑定（如「自定义服务商」表单，
            // 其数据是对象数组，由下方 dedicated 逻辑整份读写）。
            // 注意这里必须判空——getAttribute 返回 null 时直接 .split() 会抛错并中断整个 onload，
            // 导致页面上所有设置项都失去绑定。
            const rawPath = element.getAttribute("setting-path");
            if (!rawPath) continue;

            let settingItemPath = rawPath.split(/\s/g);
            let settingItemValue = getSetting(result, settingItemPath);

            switch (element.getAttribute("setting-type")) {
                case "checkbox":
                    element.checked = settingItemValue.indexOf(element.value) !== -1;
                    // update setting value
                    element.onchange = (event) => {
                        const target = event.target;
                        const settingItemPath = target.getAttribute("setting-path").split(/\s/g);
                        const settingItemValue = getSetting(result, settingItemPath);

                        // if user checked this option, add value to setting array
                        if (target.checked) settingItemValue.push(target.value);
                        // if user unchecked this option, delete value from setting array
                        else settingItemValue.splice(settingItemValue.indexOf(target.value), 1);
                        saveOption(result, settingItemPath, settingItemValue);
                    };
                    break;
                case "radio":
                    element.checked = settingItemValue === element.value;
                    // update setting value
                    element.onchange = (event) => {
                        const target = event.target;
                        const settingItemPath = target.getAttribute("setting-path").split(/\s/g);
                        if (target.checked) {
                            saveOption(result, settingItemPath, target.value);
                        }
                    };
                    break;
                case "switch":
                    element.checked = settingItemValue;
                    // update setting value
                    element.onchange = (event) => {
                        const settingItemPath = event.target
                            .getAttribute("setting-path")
                            .split(/\s/g);
                        saveOption(result, settingItemPath, event.target.checked);
                    };
                    break;
                case "select":
                    element.value = settingItemValue;
                    // update setting value
                    element.onchange = (event) => {
                        const target = event.target;
                        const settingItemPath = target.getAttribute("setting-path").split(/\s/g);
                        saveOption(
                            result,
                            settingItemPath,
                            target.options[target.selectedIndex].value
                        );
                    };
                    break;
                case "text":
                    element.value = settingItemValue || "";
                    // update setting value
                    element.oninput = (event) => {
                        const target = event.target;
                        const settingItemPath = target.getAttribute("setting-path").split(/\s/g);
                        saveOption(result, settingItemPath, target.value);
                    };
                    break;
                case "password":
                    element.value = settingItemValue || "";
                    // update setting value
                    element.oninput = (event) => {
                        const target = event.target;
                        const settingItemPath = target.getAttribute("setting-path").split(/\s/g);
                        saveOption(result, settingItemPath, target.value);
                    };
                    break;
                default:
                    break;
            }
        }

        // 服务模式切换：自定义模式显示 API Key 与「自定义」选项；自定义服务商模式显示服务商表单；
        // 免费模式两者都不显示。
        const serviceSelect = document.getElementById("translation-service");
        const apiKeyRow = document.getElementById("apikey-row");
        const customModelCol = document.getElementById("custom-model-col");
        const customModelCheckbox = document.getElementById("custom-model");
        const aiModelSelect = document.getElementById("ai-model");
        const aiModelInput = document.getElementById("ai-model-input");
        const modelColumn = document.getElementById("model-column");
        const providerSection = document.getElementById("provider-section");

        // 「自定义」勾选时：隐藏模型下拉、显示同位可编辑输入框（不额外占行）
        const syncCustomModelVisibility = () => {
            if (!customModelCheckbox) return;
            const checked = customModelCheckbox.checked;
            if (aiModelSelect) aiModelSelect.style.display = checked ? "none" : "";
            if (aiModelInput) aiModelInput.style.display = checked ? "" : "none";
        };

        const syncServiceVisibility = () => {
            if (!serviceSelect) return;
            const mode = serviceSelect.value;
            const isSiliconFlowCustom = (mode === "custom");
            const isProvider = (mode === "provider");

            if (apiKeyRow) apiKeyRow.style.display = isSiliconFlowCustom ? "" : "none";
            if (customModelCol) customModelCol.style.display = isSiliconFlowCustom ? "" : "none";
            if (providerSection) providerSection.style.display = isProvider ? "" : "none";

            // 整列隐藏「翻译模型」：provider 模式下模型写在各自的服务商配置里，
            // 这里的 AIModel 与它无关，留着只会让人以为要在这里选。
            if (modelColumn) modelColumn.style.display = isProvider ? "none" : "";

            if (isSiliconFlowCustom) {
                syncCustomModelVisibility();
            } else if (!isProvider) {
                // 切回免费模式：恢复下拉、隐藏输入
                if (aiModelSelect) aiModelSelect.style.display = "";
                if (aiModelInput) aiModelInput.style.display = "none";
            }
        };

        if (serviceSelect) {
            syncServiceVisibility();
            serviceSelect.addEventListener("change", syncServiceVisibility);
        }
        if (customModelCheckbox) {
            syncCustomModelVisibility();
            customModelCheckbox.addEventListener("change", syncCustomModelVisibility);
        }

        // 自定义服务商表单（与声明式绑定无关，整份读写 CustomProviders / ActiveProviderId）
        // 复用模块级 channel：再 new 一个会重复注册 runtime.onMessage 监听器
        initProviderSection(syncServiceVisibility, channel);
    });
};

/**
 * 生成一个稳定的服务商 id。
 *
 * 用浏览器自带的 randomUUID（扩展页面是安全上下文，一定可用）；
 * 极旧内核下退化为时间戳 + 随机数，仍能保证不与已有 id 冲突。
 *
 * @returns {string} id
 */
function generateProviderId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 初始化「自定义服务商」表单：列表增删、字段编辑、测试连接、拉取模型列表。
 *
 * 服务商列表的归一化直接复用 customProviderSettings.js 的实现——设置页与后台必须对
 * 「列表里有哪些项、每项 id 是什么」得出一致结论，否则会出现
 * 「设置页显示服务商 B、请求实际发给了 A」这类静默错用。
 *
 * @param {Function} onChange 服务商列表变化后的回调（用于同步入口的可见性/占位提示）
 * @param {Channel} channel 通信通道（复用模块级实例）
 */
function initProviderSection(onChange, channel) {
    const section = document.getElementById("provider-section");
    if (!section) return;

    const selector = document.getElementById("provider-select");
    const editor = document.getElementById("provider-editor");
    const emptyHint = document.getElementById("provider-empty-hint");
    const nameInput = document.getElementById("provider-name");
    const endpointInput = document.getElementById("provider-endpoint");
    const apiKeyInput = document.getElementById("provider-api-key");
    const modelInput = document.getElementById("provider-model");
    const modelList = document.getElementById("provider-model-list");
    const headersInput = document.getElementById("provider-headers");
    const addButton = document.getElementById("provider-add");
    const deleteButton = document.getElementById("provider-delete");
    const testButton = document.getElementById("provider-test");
    const modelsButton = document.getElementById("provider-models");
    const statusEl = document.getElementById("provider-status");

    /** @type {Array<Object>} */
    let providers = [];
    let activeId = "";
    let saveTimer = null;

    const setStatus = (text, kind) => {
        if (!statusEl) return;
        statusEl.textContent = text || "";
        statusEl.classList.remove("ok", "err");
        if (kind) statusEl.classList.add(kind);
    };

    /**
     * 落盘。做 400ms 防抖：storage.sync 有「每分钟 120 次写」的硬配额，
     * 逐键写入会在正常打字速度下直接超限（超限后写入被丢弃，表现为「改了没保存」）。
     *
     * 同时守住单条目 8KB 上限：整个服务商数组是**一个** storage 条目，
     * 超限时 set 会失败且不报错，用户会以为保存成功——所以主动检查并提示。
     */
    const persist = (immediate) => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        const write = () => {
            const payload = { CustomProviders: providers, ActiveProviderId: activeId };

            const size = JSON.stringify(providers).length;
            if (size > 8000) {
                const message = chrome.i18n.getMessage("ProviderQuotaExceeded") || "服务商数量过多，已超出浏览器同步存储上限";
                setStatus(message, "err");
                return;
            }

            chrome.storage.sync.set(payload, () => {
                const error = chrome.runtime.lastError;
                if (error) {
                    setStatus(String(error.message || error), "err");
                }
            });
        };
        if (immediate) {
            write();
        } else {
            saveTimer = setTimeout(write, 400);
        }
    };

    const getActive = () => providers.find((provider) => provider.id === activeId) || null;

    /** 把当前选中的服务商填进表单 */
    const fillForm = () => {
        const provider = getActive();
        const hasProvider = !!provider;

        if (editor) editor.style.display = hasProvider ? "" : "none";
        if (emptyHint) emptyHint.style.display = hasProvider ? "none" : "";
        if (selector) selector.disabled = !hasProvider;
        if (deleteButton) deleteButton.disabled = !hasProvider;
        if (!hasProvider) {
            setStatus("", null);
            return;
        }

        nameInput.value = provider.name;
        endpointInput.value = provider.endpoint;
        apiKeyInput.value = provider.apiKey;
        modelInput.value = provider.model;
        headersInput.value = provider.headers;
        setStatus("", null);
    };

    /** 重建「当前服务商」下拉，并同步表单与入口可见性 */
    const render = () => {
        if (selector) {
            selector.innerHTML = "";
            for (const provider of providers) {
                const option = document.createElement("option");
                option.value = provider.id;
                // 名称留空时用接口地址兜底，避免下拉里出现一行空白
                option.textContent = provider.name || provider.endpoint || provider.id;
                if (provider.id === activeId) option.selected = true;
                selector.appendChild(option);
            }
        }
        fillForm();
        if (typeof onChange === "function") onChange();
    };

    /**
     * 字段编辑：写回内存里的服务商对象。
     *
     * @param {string} field 字段名
     *
     * @returns {Function} input 事件处理器
     */
    const bindField = (element, field) => {
        if (!element) return;
        element.addEventListener("input", () => {
            const provider = getActive();
            if (!provider) return;
            provider[field] = element.value;
            // 名称变化要同步到下拉里显示的文本（不重建整个下拉，免得输入过程中失焦）
            if (field === "name" && selector) {
                const option = Array.from(selector.options).find((o) => o.value === provider.id);
                if (option) {
                    option.textContent = provider.name || provider.endpoint || provider.id;
                }
            }
            persist(false);
        });
    };

    bindField(nameInput, "name");
    bindField(endpointInput, "endpoint");
    bindField(apiKeyInput, "apiKey");
    bindField(headersInput, "headers");

    // 模型输入同时支持从 datalist 里选：datalist 的候选来自「拉取模型列表」
    if (modelInput) {
        modelInput.addEventListener("input", () => {
            const provider = getActive();
            if (!provider) return;
            provider.model = modelInput.value;
            persist(false);
        });
    }

    if (selector) {
        selector.addEventListener("change", () => {
            activeId = selector.value;
            persist(true);
            render();
        });
    }

    if (addButton) {
        addButton.addEventListener("click", () => {
            const id = generateProviderId();
            const namePrefix = chrome.i18n.getMessage("ProviderDefaultName") || "Provider";
            providers.push({
                id,
                name: `${namePrefix} ${providers.length + 1}`,
                endpoint: "",
                apiKey: "",
                model: "",
                headers: "",
            });
            activeId = id;
            persist(true);
            render();
            if (endpointInput) endpointInput.focus();
        });
    }

    if (deleteButton) {
        deleteButton.addEventListener("click", () => {
            const provider = getActive();
            if (!provider) return;

            // 已配置过内容的服务商才需要二次确认，纯空白项直接删掉，不打断操作节奏
            const configured = !!(provider.endpoint || provider.apiKey || provider.model);
            if (configured) {
                const message = chrome.i18n.getMessage("ProviderDeleteConfirm") || "Delete this provider?";
                if (!window.confirm(message)) return;
            }

            const index = providers.indexOf(provider);
            providers.splice(index, 1);
            const next = providers[index] || providers[index - 1] || null;
            activeId = next ? next.id : "";
            persist(true);
            render();
        });
    }

    /** 收集表单为一份可直接发给后台的配置（未保存也能测） */
    const collectConfig = () => ({
        name: nameInput ? nameInput.value : "",
        endpoint: endpointInput ? endpointInput.value.trim() : "",
        apiKey: apiKeyInput ? apiKeyInput.value.trim() : "",
        model: modelInput ? modelInput.value.trim() : "",
        headers: headersInput ? headersInput.value : "",
    });

    if (testButton) {
        testButton.addEventListener("click", async () => {
            const config = collectConfig();
            if (!config.endpoint) {
                setStatus(chrome.i18n.getMessage("ProviderNeedEndpoint") || "请先填写接口地址", "err");
                return;
            }

            testButton.disabled = true;
            setStatus(chrome.i18n.getMessage("ProviderTesting") || "测试中…", null);
            try {
                const result = await channel.request("test_custom_provider", { config });
                // 通道把提供方抛出的异常包成 {__serviceError}，这里必须自己拆一层
                if (result && result.__serviceError) {
                    setStatus(result.__serviceError, "err");
                    return;
                }
                if (result && result.ok) {
                    const label = chrome.i18n.getMessage("ProviderTestOk") || "连接成功";
                    setStatus(result.sample ? `${label}：${result.sample}` : label, "ok");
                } else {
                    const label = chrome.i18n.getMessage("ProviderTestFail") || "测试失败";
                    setStatus(`${label}：${(result && result.message) || ""}`, "err");
                }
            } catch (error) {
                setStatus(String((error && error.message) || error), "err");
            } finally {
                testButton.disabled = false;
            }
        });
    }

    if (modelsButton) {
        modelsButton.addEventListener("click", async () => {
            const config = collectConfig();
            if (!config.endpoint) {
                setStatus(chrome.i18n.getMessage("ProviderNeedEndpoint") || "请先填写接口地址", "err");
                return;
            }

            modelsButton.disabled = true;
            setStatus(chrome.i18n.getMessage("ProviderFetching") || "拉取中…", null);
            try {
                const models = await channel.request("list_custom_provider_models", { config });
                if (models && models.__serviceError) {
                    setStatus(models.__serviceError, "err");
                    return;
                }
                if (!Array.isArray(models) || models.length === 0) {
                    setStatus(chrome.i18n.getMessage("ProviderNoModels") || "没有取到模型", "err");
                    return;
                }

                if (modelList) {
                    modelList.innerHTML = "";
                    for (const name of models) {
                        const option = document.createElement("option");
                        option.value = name;
                        modelList.appendChild(option);
                    }
                }
                if (modelInput) modelInput.focus();

                // 用 i18n 的占位符替换（$1）而不是手工拼接，翻译才能自由调整语序
                const label = chrome.i18n.getMessage("ProviderFetched", [String(models.length)]);
                setStatus(label || `已获取 ${models.length} 个模型`, "ok");
            } catch (error) {
                setStatus(String((error && error.message) || error), "err");
            } finally {
                modelsButton.disabled = false;
            }
        });
    }

    // 载入已保存的服务商
    getOrSetDefaultSettings(["CustomProviders", "ActiveProviderId"], DEFAULT_SETTINGS).then((result) => {
        providers = normalizeProviders(result.CustomProviders);
        activeId = result.ActiveProviderId || "";
        if (!providers.some((provider) => provider.id === activeId)) {
            activeId = providers.length ? providers[0].id : "";
        }
        render();
    });
}

/**
 *
 * get setting value according to path of setting item
 *
 * @param {Object} localSettings setting object stored in local
 * @param {Array} settingItemPath path of the setting item
 * @returns {*} setting value
 */
function getSetting(localSettings, settingItemPath) {
    let result = localSettings;
    settingItemPath.forEach((key) => {
        result = result[key];
    });
    return result;
}

/**
 * 保存一条设置项
 *
 * @param {Object} localSettings  本地存储的设置项
 * @param {Array} settingItemPath 设置项的层级路径
 * @param {*} value 设置项的值
 */
function saveOption(localSettings, settingItemPath, value) {
    // update local settings
    let pointer = localSettings; // point to children of local setting or itself

    // point to the leaf item recursively
    for (let i = 0; i < settingItemPath.length - 1; i++) {
        pointer = pointer[settingItemPath[i]];
    }
    // update the setting leaf value
    pointer[settingItemPath[settingItemPath.length - 1]] = value;

    let result = {};
    result[settingItemPath[0]] = localSettings[settingItemPath[0]];
    chrome.storage.sync.set(result);
}
