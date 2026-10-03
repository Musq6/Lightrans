/** @jsx h */
import { h, Fragment } from "preact";
import { useEffect, useState, useRef, useCallback, useMemo } from "preact/hooks";
import { useLatest, useEvent, useClickAway } from "react-use";
import styled, { createGlobalStyle, ThemeProvider } from "styled-components";
import root from "react-shadow/styled-components";
import SimpleBar from "simplebar-react";
import SimpleBarStyle from "simplebar-react/dist/simplebar.min.css";
import Channel from "common/scripts/channel.js";
import Moveable from "./library/moveable/moveable.js";
import { delayPromise } from "common/scripts/promise.js";
import { DEFAULT_SETTINGS, getOrSetDefaultSettings } from "common/scripts/settings.js";
import { normalizeProviders } from "common/scripts/customProviderSettings.js";
import { buildModelOptions, pickActiveModelKey } from "common/scripts/modelOptions.js";
import { isChromePDFViewer } from "../common.js";
import Result from "./Result.jsx"; // display translate result
import { resolveDisplayStyle, fs, FONT_SCALE, FONT_SIZE_VAR } from "./displayStyle.js"; // 译文显示样式解析
import Loading from "./Loading.jsx"; // display loading animation
import Error from "./Error.jsx"; // display error messages
import Dropdown from "./Dropdown.jsx";
import SettingIcon from "./icons/setting.svg";
import PinIcon from "./icons/pin.svg";
import CloseIcon from "./icons/close.svg";

// Communication channel.
const channel = new Channel();
// Store the translation result and attach it to window.
window.translateResult = {};
// Flag of showing result.
window.isDisplayingResult = false;
// Store the width of scroll bar.
const scrollbarWidth = getScrollbarWidth();
// Store original css text on document.body.
let documentBodyCSS = "";
// The duration time of result panel's transition. unit: ms.
const transitionDuration = 500;

export default function ResultPanel() {
    // Whether the result is open.
    const [open, setOpen] = useState(false);
    // Whether the panel is fixed(the panel won't be close when users click outside of the it).
    const [panelFix, setPanelFix] = useState();
    // "LOADING" | "RESULT" | "ERROR"
    const [contentType, setContentType] = useState("LOADING");
    const contentTypeRef = useLatest(contentType);
    // translate results or error messages
    const [content, setContent] = useState({});
    // refer to the latest content equivalent to useRef()
    const contentRef = useLatest(content);
    // 翻译服务模式："free" | "custom" | "provider"
    const [serviceMode, setServiceMode] = useState("free");
    // provider 模式下的服务商列表与当前选中项
    const [providers, setProviders] = useState([]);
    const [activeProviderId, setActiveProviderId] = useState("");
    // 其余模式下的内置模型列表与当前模型
    const [builtinModels, setBuiltinModels] = useState([]);
    const [currentAIModel, setCurrentAIModel] = useState("");

    // 顶部「翻译来源」下拉的选项与当前选中项。
    // provider 模式下选项是各个服务商（切换即换服务商），其余模式是内置模型。
    const modelOptions = useMemo(
        () => buildModelOptions({ mode: serviceMode, providers, models: builtinModels }),
        [serviceMode, providers, builtinModels]
    );
    const activeModelKey = useMemo(
        () =>
            pickActiveModelKey({
                mode: serviceMode,
                providers,
                activeId: activeProviderId,
                currentModel: currentAIModel,
            }),
        [serviceMode, providers, activeProviderId, currentAIModel]
    );
    const activeModelLabel = useMemo(() => {
        const matched = modelOptions.find((option) => option.key === activeModelKey);
        return matched ? matched.label : "";
    }, [modelOptions, activeModelKey]);
    // Control the behavior of highlight part(a placeholder to preview the "fixed" style panel).
    const [highlight, setHighlight] = useState({
        show: false, // whether to show the highlight part
        position: "right", // the position of the highlight part. value: "left"|"right"
    });
    // state of display type("floating" | "fixed")
    const [displayType, setDisplayType] = useState("floating");
    /**
     * Wether we use a mask layer in chrome native pdf viewer.
     * In the chrome native pdf viewer, mouse events can't be detected. In order to make the panel resizable, we build a mask layer that fills the whole page to detect mouse events.
     */
    const [usePDFMaskLayer, setUsePDFMaskLayer] = useState(false);
    // 译文显示样式：把设置里的 DisplayStyle 解析成一组可直接使用的样式值
    const [displayStyle, setDisplayStyle] = useState(() => resolveDisplayStyle());

    const containerElRef = useRef(), // the container of translation panel.
        panelElRef = useRef(), // panel element
        headElRef = useRef(), // panel head element
        bodyElRef = useRef(); // panel body element

    // Indicate whether the movable panel is ready or not.
    const [moveableReady, setMoveableReady] = useState(false);
    // store the moveable object returned by moveable.js
    const moveablePanelRef = useRef(null);
    const simplebarRef = useRef();
    // store the display type("floating"|"fixed")
    const displaySettingRef = useRef({
        type: "floating",
        fixedData: {
            width: 0.2,
            position: "right",
        },
        floatingData: {
            width: 0.3,
            height: 0.4,
        },
    });
    // flag whether the user set to resize document body when panel is resized in fixed display mode
    const resizePageFlag = useRef(false);

    /**
     * Update the bounds value for draggable area.
     */
    const updateBounds = useCallback(async () => {
        // If the panel is open
        if (containerElRef.current) {
            await getDisplaySetting();
            let scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft;
            let scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
            moveablePanelRef.current?.setBounds({
                left: scrollLeft,
                top: scrollTop,
                right: scrollLeft + window.innerWidth - (hasScrollbar() ? scrollbarWidth : 0),
                bottom:
                    scrollTop +
                    (1 + displaySettingRef.current.floatingData.height) * window.innerHeight -
                    64,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * 从后台取一次当前的服务模式与自定义服务商状态。
     *
     * 失败时保持默认值（free + 空列表）而不抛出：结果框是内容脚本，
     * 后台服务重启的瞬间取不到数据是正常情况，不该因此让整块面板渲染失败。
     */
    const loadServiceState = useCallback(() => {
        channel
            .request("get_translation_service_state", {})
            .then((state) => {
                if (!state) return;
                setServiceMode(state.mode || "free");
                setProviders(normalizeProviders(state.providers));
                setActiveProviderId(state.activeId || "");
            })
            .catch(() => {});
    }, []);

    /**
     * 切换顶部下拉里的「翻译来源」。
     *
     * provider 模式下选的是服务商（写 ActiveProviderId），其余模式选的是内置模型
     * （写 AIModel）——两条路径写的是不同的设置项，但都立刻重译当前文本，
     * 否则用户会觉得「切了没反应」。
     *
     * @param {string} key 选中的下拉项 key
     */
    const changeModelSource = useCallback(
        (key) => {
            // 乐观更新：下拉的选中态由 state 推导，等 storage 回音再更新会让高亮迟一拍
            if (serviceMode === "provider") setActiveProviderId(key);
            else setCurrentAIModel(key);

            const request =
                serviceMode === "provider"
                    ? channel.request("set_active_provider", { id: key })
                    : channel.request("update_ai_model", { model: key });

            request.then(() => {
                if (window.translateResult.originalText) {
                    channel.request("translate", { text: window.translateResult.originalText });
                }
            });
        },
        [serviceMode]
    );

    /**
     * The handler for window resize event.
     * Update drag bounds and the size or position of the result panel.
     */
    const windowResizeHandler = useCallback(() => {
        updateBounds();
        // If result panel is open.
        if (panelElRef.current) {
            if (displaySettingRef.current.type === "fixed") showFixedPanel();
            else showFloatingPanel();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Do some initialization stuff */
    useEffect(() => {
        getDisplaySetting();

        getOrSetDefaultSettings(["languageSetting", "AIModel"], DEFAULT_SETTINGS).then(
            async (result) => {
                setBuiltinModels(await channel.request("get_available_ai_models", {}));
                setCurrentAIModel(result.AIModel);
            }
        );

        // 服务模式与自定义服务商：向后台取一次当前状态。
        // 内容脚本读不到后台内存里的服务商列表，必须走通道；
        // 这也保证结果框显示的列表与后台实际使用的那份同源。
        loadServiceState();

        getOrSetDefaultSettings("fixSetting", DEFAULT_SETTINGS).then((result) => {
            setPanelFix(result.fixSetting);
        });

        // 译文显示样式：读取一次，并在设置变更时实时生效
        getOrSetDefaultSettings("DisplayStyle", DEFAULT_SETTINGS).then((result) => {
            setDisplayStyle(resolveDisplayStyle(result.DisplayStyle));
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "sync") return;

            if (changes.DisplayStyle) {
                setDisplayStyle(resolveDisplayStyle(changes.DisplayStyle.newValue));
            }
            // 服务模式 / 服务商列表 / 选中项 / 内置模型 在设置页被改动后，
            // 已打开的结果框要跟着更新，否则会一直显示旧的翻译来源。
            if (changes.TranslationService) {
                setServiceMode(changes.TranslationService.newValue || "free");
            }
            if (changes.CustomProviders) {
                setProviders(normalizeProviders(changes.CustomProviders.newValue));
            }
            if (changes.ActiveProviderId) {
                setActiveProviderId(changes.ActiveProviderId.newValue || "");
            }
            if (changes.AIModel) {
                setCurrentAIModel(changes.AIModel.newValue || "");
            }
        });

        /*
         * COMMUNICATE WITH BACKGROUND MODULE
         */
        // The translator send this request to make sure current tab can display result panel.
        channel.provide("check_availability", () => Promise.resolve());

        channel.on("start_translating", (detail) => {
            if (checkTimestamp(detail.timestamp)) {
                // cache translation text.
                window.translateResult.originalText = detail.text;
                setOpen(true);
                setContentType("LOADING");
                setContent(detail);
            }
        });

        channel.on("translating_finished", (detail) => {
            if (checkTimestamp(detail.timestamp)) {
                window.translateResult = detail;
                setOpen(true);
                setContentType("RESULT");
                setContent(detail);
            }
        });

        channel.on("translating_error", (detail) => {
            if (checkTimestamp(detail.timestamp)) {
                setContentType("ERROR");
                setContent(detail);
            }
        });

        channel.on("update_translator_options", (detail) => {
            // 该事件当前没有任何发出方（保留兼容）：只更新内置模型列表，
            // 服务商列表仍以后台的 get_translation_service_state 为准。
            setBuiltinModels(detail.availableTranslators || []);
        });

        channel.on("command", (detail) => {
            switch (detail.command) {
                case "fix_result_frame":
                    getOrSetDefaultSettings("fixSetting", DEFAULT_SETTINGS).then((result) => {
                        setPanelFix(!result.fixSetting);
                        chrome.storage.sync.set({
                            fixSetting: !result.fixSetting,
                        });
                    });
                    break;
                case "close_result_frame":
                    setOpen(false);
                    break;
                default:
                    break;
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * When status of result panel is changed(open or close), this function will be triggered.
     */
    const onDisplayStatusChange = useCallback((panelEl) => {
        panelElRef.current = panelEl;

        /* If panel is closed */
        if (!panelEl) {
            // Clear the outdated moveable object.
            moveablePanelRef.current = null;
            setMoveableReady(false);

            // Tell select.js that the result panel has been removed.
            window.isDisplayingResult = false;

            removeFixedPanel();

            // Handle the click event exception when using chrome's original pdf viewer
            if (isChromePDFViewer()) {
                document.body.children[0].focus();
            }

            // Tell background module that the result panel has been closed
            channel.emit("frame_closed");
            return;
        }

        /* else if panel is open */
        // Tell select.js that we are displaying results.
        window.isDisplayingResult = true;

        /* Make the resultPanel resizable and draggable */
        moveablePanelRef.current = new Moveable(panelEl, {
            draggable: true,
            resizable: true,
            /* Set threshold value to increase the resize area */
            // threshold: { s: 5, se: 5, e: 5, ne: 5, n: 5, nw: 5, w: 5, sw: 5 },
            // threshold: { edge:5, corner:5 },
            threshold: 5,
            /**
             * Set thresholdPosition to decide where the resizable area is
             * "in": the activated resizable area is within the target element
             * "center": the activated resizable area is half within the target element and half out of the it
             * "out": the activated resizable area is out of the target element
             * a number(0~1): a ratio which determines the how much the the activated resizable area beyond the element
             */
            // thresholdPosition: "in",
            // thresholdPosition: "center",
            // thresholdPosition: "out",
            thresholdPosition: 0.7,
            minWidth: 180,
            minHeight: 150,
        });

        let startTranslate = [0, 0];
        // To flag whether the floating panel should be changed to fixed panel.
        let floatingToFixed = false;
        // Store the fixed direction on bound event.
        let fixedDirection = "";
        /* draggable events*/
        moveablePanelRef.current
            .on("dragStart", ({ set, stop, inputEvent }) => {
                if (inputEvent) {
                    const path =
                        inputEvent.path || (inputEvent.composedPath && inputEvent.composedPath());
                    // If drag element isn't the head element, stop the drag event.
                    if (!path || !headElRef.current?.isSameNode(path[0])) {
                        stop();
                        return;
                    }
                }
                set(startTranslate);
                // Open the pdf mask layer.
                if (isChromePDFViewer()) setUsePDFMaskLayer(true);
            })
            .on("drag", ({ target, translate }) => {
                startTranslate = translate;
                target.style.transform = `translate(${translate[0]}px, ${translate[1]}px)`;
            })
            .on("dragEnd", ({ translate, inputEvent }) => {
                startTranslate = translate;

                /* Change the display type of result panel */
                if (inputEvent && displaySettingRef.current.type === "floating") {
                    if (floatingToFixed) {
                        displaySettingRef.current.fixedData.position = fixedDirection;
                        displaySettingRef.current.type = "fixed";
                        // remove the highlight part
                        setHighlight({
                            show: false,
                            position: "right",
                        });
                        showFixedPanel();
                        updateDisplaySetting();
                    }
                }
                // Close the pdf mask layer.
                setUsePDFMaskLayer(false);
            })
            // // The result panel start to drag out of the drag area
            // .on("boundStart", ({ direction }) => {
            //     console.log(direction);
            // })
            // The result panel drag out of the drag area
            .on("bound", ({ direction, distance }) => {
                /* Whether to show hight part on the one side of the page*/
                if (displaySettingRef.current.type === "floating") {
                    let threshold = 10;
                    if (distance > threshold) {
                        if (direction === "left" || direction === "right") {
                            fixedDirection = direction;
                            floatingToFixed = true;
                            // show highlight part
                            setHighlight({
                                show: true,
                                position: direction,
                            });
                        }
                    }
                }
            })
            // The result panel drag into drag area first time
            .on("boundEnd", () => {
                if (floatingToFixed)
                    // remove the highlight part
                    setHighlight({
                        show: false,
                        position: "right",
                    });
                floatingToFixed = false;
                // Change the display type from fixed to floating
                if (displaySettingRef.current.type === "fixed") {
                    displaySettingRef.current.type = "floating";
                    removeFixedPanel();
                    showFloatingPanel();
                    updateDisplaySetting();
                    // The height of content in fixed panel may be different from the height in floating panel so we need to update the height of floating panel after a little delay.
                    setTimeout(showFloatingPanel, 50);
                }
            });
        /* Listen to resizable  events */
        moveablePanelRef.current
            .on("resizeStart", ({ set }) => {
                set(startTranslate);
                // Open the pdf mask layer.
                if (isChromePDFViewer()) setUsePDFMaskLayer(true);
            })
            .on("resize", ({ target, width, height, translate, inputEvent }) => {
                target.style.width = `${width}px`;
                target.style.height = `${height}px`;
                target.style.transform = `translate(${translate[0]}px, ${translate[1]}px)`;
                if (inputEvent) {
                    if (displaySettingRef.current.type === "fixed" && resizePageFlag.current) {
                        document.body.style.width = `${(1 - width / window.innerWidth) * 100}%`;
                    }
                }
            })
            .on("resizeEnd", ({ translate, width, height, inputEvent, target }) => {
                startTranslate = translate;
                target.style.transform = `translate(${translate[0]}px, ${translate[1]}px)`;

                // Update new size of the result panel
                if (inputEvent) {
                    if (displaySettingRef.current.type === "floating") {
                        displaySettingRef.current.floatingData.width = width / window.innerWidth;
                        displaySettingRef.current.floatingData.height = height / window.innerHeight;
                    } else {
                        displaySettingRef.current.fixedData.width = width / window.innerWidth;
                    }
                    updateDisplaySetting();
                }
                // Close the pdf mask layer.
                setUsePDFMaskLayer(false);
            });
        showPanel();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Fit the floating panel to the content size after the content is updated. */
    useEffect(() => {
        if (displaySettingRef.current.type === "floating")
            // The panel doesn't have to fit the loading animation so the delay won't be necessary.
            setTimeout(showFloatingPanel, contentType === "LOADING" ? 0 : 100);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentType]);

    // Update drag bounds when users scroll the page
    useEvent("scroll", updateBounds, window);

    // Update the drag bounds and size when the size of window has changed
    useEvent("resize", windowResizeHandler, window);

    useClickAway(containerElRef, () => {
        // The panel will be closed if users click outside of the it with the panelFix option closed.
        if (!panelFix) {
            setOpen(false);
        }
    });

    /**
     * Display the panel.
     */
    async function showPanel() {
        await getDisplaySetting();
        updateBounds();
        
        // 强制使用浮动模式
        displaySettingRef.current.type = "floating";
        updateDisplaySetting();
        
        /* show floating panel */
        let position;
        let width = displaySettingRef.current.floatingData.width * window.innerWidth;
        let height = displaySettingRef.current.floatingData.height * window.innerHeight;
        
        if (contentRef.current.position) {
            /* Adjust the position of result panel. Avoid to beyond the range of page */
            const XBias = 10,
                YBias = 10;
            position = [contentRef.current.position[0], contentRef.current.position[1]];
            
            // 计算面板的尺寸
            const panelWidth = width;
            const panelHeight = height;
            
            // 计算页面的边界
            const pageWidth = window.innerWidth;
            const pageHeight = window.innerHeight;
            
            // 尝试将面板显示在选中词语的下方
            let panelX = position[0];
            let panelY = position[1] + contentRef.current.selectionHeight + YBias;
            
            // 如果面板超出右侧边界，调整水平位置
            if (panelX + panelWidth > pageWidth) {
                panelX = pageWidth - panelWidth - XBias;
            }
            
            // 如果面板超出底部边界，将其显示在选中词语的上方
            if (panelY + panelHeight > pageHeight) {
                panelY = position[1] - panelHeight - YBias;
                // 如果面板超出顶部边界，调整垂直位置
                if (panelY < 0) {
                    panelY = 0;
                }
            }
            
            // 确保面板不会超出左侧边界
            if (panelX < 0) {
                panelX = XBias;
            }
            
            position = [panelX, panelY];
        } else {
            // 如果没有位置信息，显示在视口中央
            position = [
            (window.innerWidth - width) / 2,
            (window.innerHeight - height) / 2
        ];
        }
        
        showFloatingPanel();
        moveablePanelRef.current.request("draggable", { x: position[0], y: position[1] });
        
        // Indicate that the movable panel is ready to show.
        setMoveableReady(true);
    }

    /**
     * Show the result panel in the floating type.
     */
    function showFloatingPanel() {
        if (!moveablePanelRef.current || !headElRef.current) return;
        setDisplayType("floating");
        let panelHeight = displaySettingRef.current.floatingData.height * window.innerHeight;
        /* Fit the panel to the content size */
        if (contentTypeRef.current === "RESULT" || contentTypeRef.current === "ERROR") {
            const headHeight = headElRef.current?.clientHeight || 0;
            const contentHeight = simplebarRef.current?.getContentElement()?.clientHeight || 0;
            const actualHeight = headHeight + contentHeight;
            
            // If the height of simplebar content element isn't 0.
            if (actualHeight !== headHeight && panelHeight > actualHeight)
                panelHeight = actualHeight;
        }
        moveablePanelRef.current.request("resizable", {
            width: displaySettingRef.current.floatingData.width * window.innerWidth,
            height: panelHeight,
        });
    }

    /**
     * Show the result panel in the fixed type.
     */
    function showFixedPanel() {
        setDisplayType("fixed");
        let width = displaySettingRef.current.fixedData.width * window.innerWidth;
        // the offset left value for fixed result panel
        let offsetLeft = 0;
        if (displaySettingRef.current.fixedData.position === "right")
            offsetLeft = window.innerWidth - width - (hasScrollbar() ? scrollbarWidth : 0);
        getOrSetDefaultSettings("LayoutSettings", DEFAULT_SETTINGS).then(async (result) => {
            resizePageFlag.current = result.LayoutSettings.Resize;
            // user set to resize the document body
            if (resizePageFlag.current) {
                // If `documentBodyCSS` is empty, this means the panel is created for the first time. Ths creation animation is only needed when the panel is firstly created.
                if (documentBodyCSS === "") {
                    // store the original css text. when fixed panel is removed, restore the style of document.body
                    documentBodyCSS = document.body.style.cssText;

                    document.body.style.position = "absolute";
                    document.body.style.transition = `width ${transitionDuration}ms`;
                    panelElRef.current.style.transition = `width ${transitionDuration}ms`;
                    /* set the start width to make the transition effect work */
                    document.body.style.width = "100%";
                    move(0, window.innerHeight, offsetLeft, 0);
                    // wait some time to make the setting of width applied
                    await delayPromise(50);
                }
                // the fixed panel in on the left side
                if (displaySettingRef.current.fixedData.position === "left") {
                    document.body.style.right = "0";
                    document.body.style.left = "";
                }
                // the fixed panel in on the right side
                else {
                    document.body.style.margin = "0";
                    document.body.style.right = "";
                    document.body.style.left = "0";
                }
                // set the target width for document body
                document.body.style.width = `${
                    (1 - displaySettingRef.current.fixedData.width) * 100
                }%`;
                // set the target width for the result panel
                move(width, window.innerHeight, offsetLeft, 0);
                /* cancel the transition effect after the panel showed */
                await delayPromise(transitionDuration);
                panelElRef.current.style.transition = "";
                document.body.style.transition = "";
            } else move(width, window.innerHeight, offsetLeft, 0);
        });
    }

    /**
     * If user choose to resize the document body, make the page return to normal size.
     */
    async function removeFixedPanel() {
        if (resizePageFlag.current) {
            document.body.style.transition = `width ${transitionDuration}ms`;
            await delayPromise(50);
            document.body.style.width = "100%";
            await delayPromise(transitionDuration);
            document.body.style.cssText = documentBodyCSS;
            documentBodyCSS = "";
        }
    }

    /**
     * Drag the target element to a specified position and resize it to a specific size.
     * @param {number} width width
     * @param {number} height height value
     * @param {number} left x-axis coordinate of the target position
     * @param {number} top y-axis coordinate of the target position
     */
    function move(width, height, left, top) {
        moveablePanelRef.current.request("draggable", {
            x: left,
            y: top,
        });
        moveablePanelRef.current.request("resizable", {
            width,
            height,
        });
    }

    /**
     * Get the display setting in chrome.storage api.
     * @returns {Promise{undefined}} null promise
     */
    function getDisplaySetting() {
        return new Promise((resolve) => {
            getOrSetDefaultSettings("DisplaySetting", DEFAULT_SETTINGS).then((result) => {
                if (result.DisplaySetting) {
                    displaySettingRef.current = result.DisplaySetting;
                } else {
                    updateDisplaySetting();
                }
                resolve();
            });
        });
    }

    /**
     * Update the display setting in chrome.storage.
     */
    function updateDisplaySetting() {
        chrome.storage.sync.set({ DisplaySetting: displaySettingRef.current });
    }

    return (
        open && (
            <root.div
                ref={containerElRef}
                style={
                    usePDFMaskLayer
                        ? // Make the container element be the mask layer in chrome native pdf viewer.
                          {
                              // client width of the pdf embed element
                              width: document.body.children[0].clientWidth,
                              height: document.body.children[0].clientHeight,
                              position: "fixed",
                              zIndex: MaxZIndex,
                          }
                        : {}
                }
            >
                <ThemeProvider theme={displayStyle}>
                    <GlobalStyle />
                    <Panel ref={onDisplayStatusChange} displayType={displayType} data-testid="Panel">
                        {
                            // Only show the panel's content when the panel is movable.
                            moveableReady && (
                                <Fragment>
                                    <Head ref={headElRef} displayType={displayType} data-testid="Head">
                                        {/* 没有可选项时不渲染下拉：provider 模式下还没添加服务商时会走到这里，
                                            渲染一个空下拉会让人以为面板坏了 */}
                                        {modelOptions.length > 0 && (
                                            <SourceOption
                                                title={activeModelLabel}
                                                activeKey={activeModelKey}
                                                onSelect={changeModelSource}
                                                data-testid="SourceOption"
                                            >
                                                {modelOptions.map((option) => (
                                                    <Dropdown.Item
                                                        role="button"
                                                        key={option.key}
                                                        eventKey={option.key}
                                                    >
                                                        {option.label}
                                                    </Dropdown.Item>
                                                ))}
                                            </SourceOption>
                                        )}
                                        <HeadIcons>
                                            <HeadIcon
                                                role="button"
                                                title={chrome.i18n.getMessage("Settings")}
                                                onClick={() => channel.emit("open_options_page")}
                                                data-testid="SettingIcon"
                                            >
                                                <SettingIcon />
                                            </HeadIcon>
                                            <HeadIcon
                                                role="button"
                                                title={chrome.i18n.getMessage(
                                                    panelFix ? "UnfixResultFrame" : "FixResultFrame"
                                                )}
                                                onClick={() => {
                                                    setPanelFix(!panelFix);
                                                    chrome.storage.sync.set({
                                                        fixSetting: !panelFix,
                                                    });
                                                }}
                                                data-testid="PinIcon"
                                            >
                                                <StyledPinIcon fix={panelFix} />
                                            </HeadIcon>
                                            <HeadIcon
                                                role="button"
                                                title={chrome.i18n.getMessage("CloseResultFrame")}
                                                onClick={() => setOpen(false)}
                                                data-testid="CloseIcon"
                                            >
                                                <CloseIcon />
                                            </HeadIcon>
                                        </HeadIcons>
                                    </Head>
                                    <Body ref={bodyElRef}>
                                        <SimpleBar ref={simplebarRef}>
                                            {contentType === "LOADING" && <Loading />}
                                            {contentType === "RESULT" && <Result {...content} />}
                                            {contentType === "ERROR" && <Error {...content} />}
                                        </SimpleBar>
                                    </Body>
                                </Fragment>
                            )
                        }
                    </Panel>
                </ThemeProvider>
                {highlight.show && (
                    <Highlight
                        style={{
                            width: displaySettingRef.current.fixedData.width * window.innerWidth,
                            [highlight.position]: 0,
                        }}
                    />
                )}
            </root.div>
        )
    );
}

/**
 * STYLE FOR THE COMPONENT START
 */

export const MaxZIndex = 2147483647;
const ColorPrimary = "#4a8cf7";
export const ContentWrapperCenterClassName = "simplebar-content-wrapper-center";

const GlobalStyle = createGlobalStyle`
    ${SimpleBarStyle}

    /* Fix content disappearing problem. */
    [data-simplebar] {
        width: 100%;
        height: auto;
        max-height: 100%;
    }

    /* Fix content horizontally overflowing problem. */
    .simplebar-offset {
        width: 100%;
    }

    /* Adjust width of the vertical scrollbar. */
    .simplebar-track.simplebar-vertical {
        width: 8px;
    }

    /* Adjust height of the horizontal scrollbar. */
    .simplebar-track.simplebar-horizontal {
        height: 8px;
    }

    /* Adjust position, shape and color of the scrollbar thumb. */
    .simplebar-scrollbar:before {
        left: 1px;
        right: 1px;
        border-radius: 8px;
        background-color: rgba(150, 150, 150, 0.8);
    }

    /* Apply to the content wrapper, which is the parent element of simplebar-content, to align content in the vertical center. */
    .${ContentWrapperCenterClassName} {
        display: flex;
        flex-direction: column;

        // "justify-content: center;" may cause part of content hidden when overflowing, so we use pseudo elements to simulate its effect.
        &::before,
        &::after {
            content: "";
            flex: 1;
        }
    }

    /* Adjust the content container, which is the parent element of Panel Body. */
    .simplebar-content{
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
        height: auto;
    }

    /* Ensure the simplebar wrapper only takes the height of its content */
    .simplebar-wrapper {
        height: auto !important;
        max-height: 100%;
    }

    /* Ensure the simplebar-mask only takes the height of its content */
    .simplebar-mask {
        height: auto !important;
    }
`;

/**
 * @param {{
 *   displayType: "floating" | "fixed";
 * }} props
 */
const Panel = styled.div`
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    justify-content: flex-start;
    align-items: stretch;
    position: fixed;
    top: 0;
    left: 0;
    z-index: ${MaxZIndex};
    /* 圆角 / 阴影 / 底色 / 模糊均由「译文显示样式」设置决定 */
    border-radius: ${(props) =>
        props.displayType === "floating" ? `${props.theme.panelRadius}px` : 0};
    overflow: visible;
    box-shadow: ${(props) => props.theme.panelShadow};
    background: ${(props) => props.theme.panelBg};
    -webkit-backdrop-filter: ${(props) => props.theme.panelBlur};
    backdrop-filter: ${(props) => props.theme.panelBlur};

    /* Floating panel: shrink-to-fit content so short translations don't leave
       dead glass space below. The cap matches the default floating height
       (floatingData.height = 0.4) so positioning/long-content scroll are unchanged. */
    ${(props) =>
        props.displayType === "floating"
            ? `
        height: auto !important;
        max-height: 40vh;
        min-height: 88px !important;
    `
            : ""}

    /* Normalize the style of panel */
    padding: 0;
    margin: 0;
    border: ${(props) => props.theme.panelBorder};
    font-size: ${(props) => props.theme.fontSize}px;
    /* 把当前字号暴露成变量，供内部所有元素按比例折算（见 displayStyle.js 的 fs()） */
    ${FONT_SIZE_VAR}: ${(props) => props.theme.fontSize}px;
    font-weight: normal;
    color: ${(props) => props.theme.panelColor};
    line-height: 1;
    -webkit-text-size-adjust: 100%;
    box-sizing: border-box;
    -moz-tab-size: 4;
    tab-size: 4;
    font-family: system-ui, -apple-system,
        /* Firefox supports this but not yet 'system-ui' */ "Segoe UI", Roboto, Helvetica, Arial,
        sans-serif, "Apple Color Emoji", "Segoe UI Emoji";

    &:before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        z-index: -1;
        display: block;
        height: 65%;
        pointer-events: none;
        border-radius: ${(props) =>
            props.displayType === "floating" ? `${props.theme.panelRadius}px` : 0};
        background: ${(props) => props.theme.panelShine};
    }
`;

const Head = styled.div`
    padding: 8px 8px 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex: 0 0 auto;
    overflow: visible;
    cursor: grab;
    border-bottom: ${(props) => props.theme.headBorderBottom};
    background: ${(props) => props.theme.headBg};
    border-radius: ${(props) =>
        props.displayType === "floating"
            ? `${props.theme.panelRadius}px ${props.theme.panelRadius}px 0 0`
            : "0"};
`;

const HeadIcons = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
`;

const HeadIcon = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    font-style: normal;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    cursor: pointer;
    font-size: 18px;
    width: 30px;
    height: 30px;
    margin: 2px;
    border-radius: 9px;
    background-color: ${(props) => props.theme.iconButtonBg};
    transition: background-color 0.18s ease, transform 0.18s ease;

    svg {
        fill: ${(props) => props.theme.secondaryColor};
        width: 16px;
        height: 16px;
        display: block;
        transition: fill 0.2s linear;
    }

    &:hover {
        background-color: ${(props) => props.theme.iconButtonBgHover};
    }

    &:hover svg {
        fill: ${ColorPrimary};
    }

    &:active {
        transform: scale(0.92);
    }
`;

const StyledPinIcon = styled(PinIcon)`
    transition: transform 0.4s, fill 0.2s linear !important;
    ${(props) => (props.fix ? "" : "transform: rotate(45deg)")}
`;

const Body = styled.div`
    width: 100%;
    box-sizing: border-box;
    font-weight: normal;
    font-size: ${fs(FONT_SCALE.medium)};
    position: relative;
    padding-top: 6px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    overflow-x: hidden;
    overflow-y: overlay;
    overscroll-behavior: contain;
    flex-grow: 1;
    flex-shrink: 1;
    word-break: break-word;
`;

const SourceOption = styled(Dropdown)`
    max-width: 45%;
    font-weight: normal;
    font-size: ${fs(FONT_SCALE.small)};
    cursor: pointer;
    // To center the text in select box
    text-align-last: center;
    background-color: transparent;
    border-color: transparent;
    outline: none;
    // provider 模式下文案是「服务商名 · 模型名」，比单纯模型名长得多，
    // 不加省略号会把右侧的图标挤出去
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

const Highlight = styled.div`
    height: 100%;
    background: ${ColorPrimary};
    opacity: 0.3;
    position: fixed;
    top: 0;
    z-index: ${MaxZIndex};
`;

/**
 * STYLE FOR THE COMPONENT END
 */

/**
 * Check whether the translation result is the latest.
 * @param {number} timestamp the timestamp of the new translation result
 * @returns true if the result is the latest
 */
export function checkTimestamp(timestamp) {
    /**
     * Check message timestamp.
     *
     * translateResult keeps the latest(biggest) timestamp ever received.
     */
    if (window.translateResult.timestamp) {
        /**
         * When a new message with timestamp arrived, we check if the timestamp stored in translateResult
         * is bigger than the timestamp of the arriving message.
         */
        if (window.translateResult.timestamp > timestamp) {
            /**
             * If it does, which means the corresponding translating request is out of date, we drop the
             * message.
             */
            return false;
        }
        /**
         * If it doesn't, which means the corresponding translating request is up to date, we update
         * the timestamp stored in translateResult and accept the message.
         */
        window.translateResult.timestamp = timestamp;
    }
    return true;
}

/**
 * Calculate the width of scroll bar.
 * method: create a div element with a scroll bar and calculate the difference between offsetWidth and clientWidth
 * @returns {number} the width of scroll bar
 */
function getScrollbarWidth() {
    let scrollDiv = document.createElement("div");
    scrollDiv.style.cssText =
        "width: 99px; height: 99px; overflow: scroll; position: absolute; top: -9999px;";
    document.documentElement.appendChild(scrollDiv);
    let scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
    document.documentElement.removeChild(scrollDiv);
    return scrollbarWidth;
}

/**
 * Judge whether the current page has a scroll bar.
 */
function hasScrollbar() {
    return (
        document.body.scrollHeight > (window.innerHeight || document.documentElement.clientHeight)
    );
}
