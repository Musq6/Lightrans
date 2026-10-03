import Channel from "common/scripts/channel.js";
import { i18nHTML } from "common/scripts/common.js";
import { DEFAULT_SETTINGS, getOrSetDefaultSettings } from "common/scripts/settings.js";
import { normalizeProviders, resolveActiveModel } from "common/scripts/customProviderSettings.js";

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
 * 初始化「自定义服务商」区：行列表切换、草稿编辑、显式保存、测试连接、拉取模型列表。
 *
 * 为什么是「草稿 + 显式保存」而不是逐字段自动落盘：
 * 一个服务商是多字段配置（地址/密钥/模型/请求头），自动保存会把「改到一半」的中间状态
 * 也写进存储并立即生效——用户既无法取消，也看不出到底存没存。因此字段改动只进草稿，
 * 点「保存」才提交，并在编辑区给出「未保存」标记。
 *
 * 服务商列表的归一化复用 customProviderSettings.js：设置页与后台必须对
 * 「列表里有哪些项、每项 id 是什么」得出一致结论，否则会出现
 * 「设置页显示服务商 B、请求实际发给了 A」这类静默错用。
 *
 * @param {Function} onChange 列表变化后的回调（用于同步入口的可见性）
 * @param {Channel} channel 通信通道（复用模块级实例）
 */
function initProviderSection(onChange, channel) {
    const section = document.getElementById("provider-section");
    if (!section) return;

    const listEl = document.getElementById("provider-list");
    const editor = document.getElementById("provider-editor");
    const emptyHint = document.getElementById("provider-empty-hint");
    const listHint = document.getElementById("provider-list-hint");
    const nameInput = document.getElementById("provider-name");
    const endpointInput = document.getElementById("provider-endpoint");
    const apiKeyInput = document.getElementById("provider-api-key");
    const modelListEl = document.getElementById("provider-model-list");
    const modelEmptyHint = document.getElementById("provider-model-empty");
    const modelInput = document.getElementById("provider-model-input");
    const modelDatalist = document.getElementById("provider-model-datalist");
    const modelAddButton = document.getElementById("provider-model-add");
    const headersInput = document.getElementById("provider-headers");
    const addButton = document.getElementById("provider-add");
    const saveButton = document.getElementById("provider-save");
    const cancelButton = document.getElementById("provider-cancel");
    const dirtyBadge = document.getElementById("provider-dirty");
    const testButton = document.getElementById("provider-test");
    const modelsButton = document.getElementById("provider-models");
    const statusEl = document.getElementById("provider-status");

    /** @type {Array<Object>} 已保存的服务商列表 */
    let providers = [];
    /** 当前生效（翻译时实际使用）的服务商 id */
    let activeId = "";
    /** 正在编辑的草稿；null 表示没有打开编辑器 */
    let draft = null;
    /** 该草稿是否为尚未保存过的新服务商 */
    let draftIsNew = false;
    let saveTimer = null;

    const setStatus = (text, kind) => {
        if (!statusEl) return;
        statusEl.textContent = text || "";
        statusEl.classList.remove("ok", "err");
        if (kind) statusEl.classList.add(kind);
    };

    /**
     * 落盘。做 400ms 防抖以避免连续的即时写入；保存/删除这类明确动作传 true 立即写。
     *
     * 同时守住单条目 8KB 上限：整个服务商数组是**一个** storage 条目，
     * 超限时 set 会失败且不报错，用户会以为保存成功——所以主动检查并提示。
     *
     * @param {boolean} immediate 是否立即写入
     *
     * @returns {boolean} 是否真的写入了（配额超限时为 false，调用方据此不要覆盖提示）
     */
    const persist = (immediate) => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        let accepted = true;

        const write = () => {
            const payload = { CustomProviders: providers, ActiveProviderId: activeId };

            const size = JSON.stringify(providers).length;
            if (size > 8000) {
                const message = chrome.i18n.getMessage("ProviderQuotaExceeded") || "服务商数量过多，已超出浏览器同步存储上限";
                setStatus(message, "err");
                accepted = false;
                return;
            }

            chrome.storage.sync.set(payload, () => {
                const error = chrome.runtime.lastError;
                if (error) {
                    setStatus(String(error.message || error), "err");
                    accepted = false;
                }
            });
        };
        if (immediate) {
            write();
        } else {
            saveTimer = setTimeout(write, 400);
        }

        return accepted;
    };

    const findByKey = (id) => providers.find((provider) => provider.id === id) || null;

    /**
     * 草稿是否与已保存版本不同——即「丢掉这些改动会可惜」。
     *
     * 新服务商（尚未保存过）只有任一字段非空才算，全部为空时不算：
     * 用户刚点「新增」还没填任何东西，弹「要丢弃吗」纯属打扰。
     */
    const isDirty = () => {
        if (!draft) return false;
        const saved = findByKey(draft.id);
        if (!saved) {
            return !!(
                draft.endpoint ||
                draft.apiKey ||
                draft.headers ||
                (draft.models && draft.models.length)
            );
        }
        return (
            saved.name !== draft.name ||
            saved.endpoint !== draft.endpoint ||
            saved.apiKey !== draft.apiKey ||
            saved.headers !== draft.headers ||
            saved.activeModel !== draft.activeModel ||
            // 数组要按内容比：引用比较会因为每次编辑都新建数组而恒为 true
            saved.models.join("\n") !== draft.models.join("\n")
        );
    };

    /**
     * 草稿是否「尚未存入存储」——即是否需要打「未保存」标记、是否允许取消。
     *
     * 与 isDirty 是**两个问题**，不能合并：全新的草稿还没有任何内容可丢（isDirty 为 false），
     * 但它确实没被保存过，必须标记出来，否则用户点完「新增」看到的编辑区毫无「尚未保存」
     * 的提示，会以为自己已经在改了。取消按钮同理：新草稿也要能取消掉。
     */
    const isUnsaved = () => !!draft && (draftIsNew || isDirty());

    const confirmDiscard = () => {
        if (!isDirty()) return true;
        const message = chrome.i18n.getMessage("ProviderDiscardConfirm") || "有未保存的修改，继续将丢弃这些改动，确定吗？";
        return window.confirm(message);
    };

    /**
     * 渲染服务商行列表。
     *
     * 用「一行一个按钮」而不是原生下拉：每一行都能承载自己的状态与样式，
     * 当前生效的那一行才能做得和「新增 / 保存」这类操作按钮明显不同。
     */
    const renderList = () => {
        listEl.innerHTML = "";

        for (const provider of providers) {
            const row = document.createElement("div");
            row.className = "provider-item";
            row.dataset.id = provider.id;
            row.setAttribute("role", "button");
            row.tabIndex = 0;

            if (provider.id === activeId) row.classList.add("is-active");

            const main = document.createElement("div");
            main.className = "provider-item-main";

            const nameEl = document.createElement("span");
            nameEl.className = "provider-item-name";
            nameEl.textContent = provider.name || provider.endpoint || provider.id;
            main.appendChild(nameEl);

            const modelEl = document.createElement("span");
            modelEl.className = "provider-item-model";
            // 显示当前生效的模型；有多个时补一个「+N」提示还有别的可选，
            // 否则用户会以为这个服务商只配了一个模型。
            const activeModel = resolveActiveModel(provider);
            const modelCount = provider.models ? provider.models.length : 0;
            modelEl.textContent =
                activeModel && modelCount > 1
                    ? `${activeModel} +${modelCount - 1}`
                    : activeModel || provider.endpoint || "";
            main.appendChild(modelEl);

            row.appendChild(main);

            if (provider.id === activeId) {
                const badge = document.createElement("span");
                badge.className = "provider-item-badge";
                badge.textContent = chrome.i18n.getMessage("ProviderInUse") || "使用中";
                row.appendChild(badge);
            }

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "provider-item-delete";
            removeButton.textContent = "×";
            removeButton.title = chrome.i18n.getMessage("ProviderDelete") || "Delete";
            removeButton.addEventListener("click", (event) => {
                event.stopPropagation();
                removeProvider(provider.id);
            });
            row.appendChild(removeButton);

            const activate = () => selectProvider(provider.id);
            row.addEventListener("click", activate);
            row.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                }
            });

            listEl.appendChild(row);
        }
    };

    /**
     * 渲染模型行列表。
     *
     * 与服务商列表同一套交互（一行一个按钮、点击切换、行内删除），
     * 这样用户不用为「列表」这件事学两套操作。差别只在作用域：
     * 服务商行切换的是**立即生效**的当前服务商，模型行切换的只是**草稿里的**当前模型，
     * 要等「保存」才提交——与编辑区其它字段保持一致。
     */
    const renderModelList = () => {
        if (!modelListEl) return;
        modelListEl.innerHTML = "";

        const models = draft && Array.isArray(draft.models) ? draft.models : [];
        const activeModel = draft ? resolveActiveModel(draft) : "";

        if (modelEmptyHint) modelEmptyHint.style.display = models.length === 0 ? "" : "none";

        models.forEach((model) => {
            const row = document.createElement("div");
            row.className = "provider-item provider-item-model-row";
            row.dataset.model = model;
            row.setAttribute("role", "button");
            row.tabIndex = 0;

            if (model === activeModel) row.classList.add("is-active");

            const nameEl = document.createElement("span");
            nameEl.className = "provider-item-name";
            nameEl.textContent = model;
            row.appendChild(nameEl);

            if (model === activeModel) {
                const badge = document.createElement("span");
                badge.className = "provider-item-badge";
                badge.textContent = chrome.i18n.getMessage("ProviderInUse") || "使用中";
                row.appendChild(badge);
            }

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "provider-item-delete";
            removeButton.textContent = "×";
            removeButton.title = chrome.i18n.getMessage("ProviderModelRemove") || "移除";
            removeButton.addEventListener("click", (event) => {
                event.stopPropagation();
                removeModel(model);
            });
            row.appendChild(removeButton);

            const activate = () => selectModel(model);
            row.addEventListener("click", activate);
            row.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                }
            });

            modelListEl.appendChild(row);
        });
    };

    /** 把草稿填进表单 */
    const fillForm = () => {
        const hasDraft = !!draft;
        if (editor) editor.style.display = hasDraft ? "" : "none";
        if (emptyHint) emptyHint.style.display = providers.length === 0 ? "" : "none";
        if (listHint) listHint.style.display = providers.length === 0 ? "none" : "";
        if (saveButton) saveButton.disabled = !hasDraft;

        if (!hasDraft) {
            if (cancelButton) cancelButton.disabled = true;
            if (dirtyBadge) dirtyBadge.style.display = "none";
            return;
        }

        nameInput.value = draft.name;
        endpointInput.value = draft.endpoint;
        apiKeyInput.value = draft.apiKey;
        headersInput.value = draft.headers;
        // 模型输入框是「新增」用的，不是某个模型的值，每次填充都清空
        if (modelInput) modelInput.value = "";

        renderModelList();
        refreshDirtyState();
    };

    /**
     * 只刷新「未保存」相关指示，不动表单值。
     *
     * 输入过程中**不能**调 fillForm()：它会把 draft 的值写回 input，
     * 而在文本框中间位置输入时光标会被顶到末尾。
     */
    const refreshDirtyState = () => {
        const unsaved = isUnsaved();
        if (cancelButton) cancelButton.disabled = !unsaved;
        if (dirtyBadge) dirtyBadge.style.display = unsaved ? "" : "none";
    };

    const render = () => {
        renderList();
        fillForm();
        if (typeof onChange === "function") onChange();
    };

    /**
     * 打开某个服务商进行编辑。
     *
     * @param {Object} provider 要编辑的数据（已保存项或新草稿）
     * @param {boolean} isNew 是否为尚未保存过的新服务商
     */
    const startEdit = (provider, isNew) => {
        // models 必须**深拷贝**：Object.assign 只复制引用，草稿里 push/splice 会直接改到
        // providers 里那一份（"未保存的改动"就悄悄生效了，取消也回不去）。
        draft = Object.assign({}, provider, {
            models: Array.isArray(provider.models) ? [...provider.models] : [],
        });
        draftIsNew = isNew;
        setStatus("", null);
    };

    /** 把某个模型设为草稿的当前模型（只改草稿，保存后才生效） */
    const selectModel = (model) => {
        if (!draft) return;
        draft.activeModel = model;
        renderModelList();
        refreshDirtyState();
    };

    const removeModel = (model) => {
        if (!draft || !Array.isArray(draft.models)) return;

        const index = draft.models.indexOf(model);
        if (index < 0) return;
        draft.models.splice(index, 1);

        // 删掉的正是当前模型时，落到剩下的第一个，避免 activeModel 悬空
        if (resolveActiveModel(draft) !== draft.activeModel) {
            draft.activeModel = draft.models[0] || "";
        }

        renderModelList();
        refreshDirtyState();
    };

    const addModel = () => {
        if (!draft || !modelInput) return;

        const model = modelInput.value.trim();
        if (!model) {
            setStatus(chrome.i18n.getMessage("ProviderModelNeedName") || "请先填写模型名称", "err");
            modelInput.focus();
            return;
        }
        if (draft.models.includes(model)) {
            setStatus(chrome.i18n.getMessage("ProviderModelDuplicate") || "这个模型已经在列表里了", "err");
            return;
        }

        draft.models.push(model);
        // 第一个模型自动成为当前模型：否则会出现「有模型但没选中」的空档
        if (!draft.activeModel) draft.activeModel = model;

        modelInput.value = "";
        setStatus("", null);
        renderModelList();
        refreshDirtyState();
        modelInput.focus();
    };

    /** 点某一行：既切换为当前使用，也载入编辑器 */
    const selectProvider = (id) => {
        const provider = findByKey(id);
        if (!provider) return;
        if (provider.id !== activeId && !confirmDiscard()) return;

        activeId = id;
        persist(true);
        startEdit(provider, false);
        render();
    };

    const addProvider = () => {
        if (!confirmDiscard()) return;

        const namePrefix = chrome.i18n.getMessage("ProviderDefaultName") || "Provider";
        startEdit(
            {
                id: generateProviderId(),
                name: `${namePrefix} ${providers.length + 1}`,
                endpoint: "",
                apiKey: "",
                models: [],
                activeModel: "",
                headers: "",
            },
            true
        );
        render();
        if (endpointInput) endpointInput.focus();
    };

    const removeProvider = (id) => {
        const provider = findByKey(id);
        if (!provider) return;

        const message = chrome.i18n.getMessage("ProviderDeleteConfirm") || "确定删除这个服务商吗？";
        if (!window.confirm(message)) return;

        const index = providers.findIndex((item) => item.id === id);
        providers.splice(index, 1);

        // 删掉的正是正在编辑的那一项时，草稿一并作废
        if (draft && draft.id === id) {
            draft = null;
            draftIsNew = false;
        }
        if (activeId === id) {
            const next = providers[index] || providers[index - 1] || null;
            activeId = next ? next.id : "";
        }

        persist(true);
        render();
        setStatus("", null);
    };

    /** 保存草稿：校验 → 写入列表 → 落盘 */
    const saveDraft = () => {
        if (!draft) return;

        const endpoint = (draft.endpoint || "").trim();
        if (!endpoint) {
            setStatus(chrome.i18n.getMessage("ProviderNeedEndpoint") || "请先填写接口地址", "err");
            if (endpointInput) endpointInput.focus();
            return;
        }
        draft.endpoint = endpoint;

        // models 必须**深拷贝**再存：Object.assign 只复制引用，
        // 若把 draft.models 这个数组直接放进 providers，保存之后草稿与已保存项就共用同一个
        // 数组——后续在草稿里 push/splice 会静默改到已保存的那份，表现为
        // 「取消回不到原状态」「明明改了却不显示未保存」。
        const stored = Object.assign({}, draft, {
            models: Array.isArray(draft.models) ? [...draft.models] : [],
        });
        const index = providers.findIndex((provider) => provider.id === stored.id);
        if (index >= 0) providers[index] = stored;
        else providers.push(stored);

        // 刚保存的服务商直接设为当前使用：用户刚填完配置，意图就是要用它。
        // 列表原本为空时同理，避免出现「有服务商但没选中」的空档。
        if (draftIsNew || !providers.some((provider) => provider.id === activeId)) {
            activeId = stored.id;
        }
        draftIsNew = false;

        const written = persist(true);
        render();

        // 状态放最后设置：render() 会经过 fillForm()，顺序反过来会被覆盖。
        // 写入被拒（超出同步存储上限）时保留 persist 给出的错误提示，
        // 否则用户会看到「已保存」而实际什么都没存进去。
        if (!written) return;

        if (!stored.models || stored.models.length === 0) {
            setStatus(
                chrome.i18n.getMessage("ProviderModelMissing") || "已保存，但还没有模型，翻译前请补上",
                "err"
            );
        } else {
            setStatus(chrome.i18n.getMessage("ProviderSaved") || "已保存", "ok");
        }
    };

    /** 取消编辑：丢弃草稿改动 */
    const cancelDraft = () => {
        if (!draft) return;
        const saved = findByKey(draft.id);
        if (saved) {
            startEdit(saved, false);
        } else {
            // 新服务商被取消 = 直接丢弃，它从未进过列表
            draft = null;
            draftIsNew = false;
        }
        render();
    };

    /**
     * 字段改动只进草稿，不写存储。
     *
     * @param {HTMLElement} element 输入控件
     * @param {string} field 对应字段名
     */
    const bindField = (element, field) => {
        if (!element) return;
        element.addEventListener("input", () => {
            if (!draft) return;
            draft[field] = element.value;
            refreshDirtyState();
        });
    };

    bindField(nameInput, "name");
    bindField(endpointInput, "endpoint");
    bindField(apiKeyInput, "apiKey");
    bindField(headersInput, "headers");
    // 模型不是「一个字段」而是列表：输入框只用于新增，由「添加」按钮提交

    if (addButton) addButton.addEventListener("click", addProvider);
    if (saveButton) saveButton.addEventListener("click", saveDraft);
    if (cancelButton) cancelButton.addEventListener("click", cancelDraft);
    if (modelAddButton) modelAddButton.addEventListener("click", addModel);
    // 输入框里回车即添加——每次都要伸手去点按钮太啰嗦
    if (modelInput) {
        modelInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                addModel();
            }
        });
    }

    // 有未保存改动时离开页面给出提醒，避免静默丢失
    window.addEventListener("beforeunload", (event) => {
        if (!isDirty()) return;
        event.preventDefault();
        event.returnValue = "";
    });

    /**
     * 收集草稿为一份可直接发给后台的配置（未保存也能测）。
     *
     * 后台的「测试连接」「拉取模型列表」只关心**一个**模型，因此这里解析出当前活动的那个，
     * 而不是把整个列表发过去——服务商可以有多个模型是设置页的概念，
     * 请求层不必知道，translators 包也就无需改动。
     */
    const collectConfig = () => ({
        name: nameInput ? nameInput.value : "",
        endpoint: endpointInput ? endpointInput.value.trim() : "",
        apiKey: apiKeyInput ? apiKeyInput.value.trim() : "",
        model: draft ? resolveActiveModel(draft) : "",
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

                // 拉取结果是**候选**，填进输入框的候选列表，由用户挑一个点「添加」——
                // 直接全部塞进模型列表会把服务商的几十个模型一次性灌进来，反而没法用。
                if (modelDatalist) {
                    modelDatalist.innerHTML = "";
                    for (const name of models) {
                        const option = document.createElement("option");
                        option.value = name;
                        modelDatalist.appendChild(option);
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

        // 已有服务商时直接把当前生效的那个载入编辑器，打开设置页即可开始改
        const current = findByKey(activeId);
        if (current) startEdit(current, false);
        else {
            draft = null;
            draftIsNew = false;
        }

        render();
        setStatus("", null);
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
