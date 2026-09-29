import { getDomain } from "common/scripts/common.js";
import { isPDFjsPDFViewer, detectSelect } from "../common.js";
import Channel from "common/scripts/channel.js";
import { DEFAULT_SETTINGS, getOrSetDefaultSettings } from "common/scripts/settings.js";

const ImageData =
    "data:image/png;base64,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";

// Communication channel.
const channel = new Channel();

// to indicate whether the translation button has been shown
let HasButtonShown = false;

/**
 * Initiate translation button.
 */
let translationButtonContainer = document.createElement("iframe");
const iframeContainer = translationButtonContainer;
// Note: some websites can't get contentDocument e.g. https://raw.githubusercontent.com/git/git/master/Documentation/RelNotes/2.40.0.txt. So I use shadow DOM as a fallback.
document.documentElement.appendChild(translationButtonContainer);
if (translationButtonContainer.contentDocument === null) {
    translationButtonContainer = document.createElement("div");
    renderButton();
}
document.documentElement.removeChild(iframeContainer);
translationButtonContainer.id = "lightrans-button";
translationButtonContainer.style.backgroundColor = "white"; // programatically set style to compatible with the extension 'Dark Reader'

/**
 * When the user clicks the translation button, the translationButtonContainer will be mounted at document.documentElement and the load event will be triggered.
 */
function renderButton() {
    const buttonImage = document.createElement("img");
    buttonImage.src = ImageData;
    const BUTTON_SIZE = "20px";
    Object.assign(buttonImage.style, {
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        minWidth: 0,
        maxWidth: BUTTON_SIZE,
        minHeight: 0,
        maxHeight: BUTTON_SIZE,
        padding: 0,
        border: 0,
        margin: 0,
        verticalAlign: 0, // fix the style problem in some websites
        filter: "none", // https://github.com/lightrans/lightrans/projects/2#card-58817626
    });
    const translationButton = document.createElement("div");
    Object.assign(translationButton.style, {
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        padding: "6px",
        margin: 0,
        borderRadius: "50%",
        boxSizing: "content-box",
        overflow: "hidden",
        border: "none",
        cursor: "pointer",
    });
    translationButton.appendChild(buttonImage);
    getInnerParent(translationButtonContainer).appendChild(translationButton);

    const CleanStyle = {
        padding: 0,
        margin: 0,
        border: "none",
        overflow: "hidden",
    };
    Object.assign(
        translationButtonContainer.contentDocument?.documentElement.style || {},
        CleanStyle
    );
    Object.assign(translationButtonContainer.contentDocument?.body.style || {}, CleanStyle);
    translationButton.addEventListener("mousedown", buttonClickHandler);
    // 定制功能1：鼠标移动到悬浮翻译按钮时即触发翻译，无需点击
    translationButton.addEventListener("mouseenter", buttonHoverHandler);
    translationButton.addEventListener("contextmenu", (e) => e.preventDefault());
}
translationButtonContainer.addEventListener("load", renderButton);

let originScrollX = 0; // record the original scroll X position(before scroll event)
let originScrollY = 0; // record the original scroll Y position(before scroll event)
let originPositionX = 0; // record the original X position of selection icon(before scroll event)
let originPositionY = 0; // record the original Y position of selection icon(before scroll event)
let scrollingElement = window; // store the specific scrolling element. In normal web pages, window is the scrolling object, while in pdf.js viewer, "#viewerContainer" is the scrolling element.
// store the name of scroll property according to scrollingElement(pageXOffset for window and scrollLeft for pdf.js element)
let scrollPropertyX = "pageXOffset";
let scrollPropertyY = "pageYOffset";
// store the position setting of the translation button. default: "TopLeft"
let ButtonPositionSetting = "TopRight";

// Fetch the button position setting.
getOrSetDefaultSettings("LayoutSettings", DEFAULT_SETTINGS).then((result) => {
    ButtonPositionSetting = result.LayoutSettings.SelectTranslatePosition;
});
// Update the button position setting when the setting is changed.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.LayoutSettings) return;
    ButtonPositionSetting = changes.LayoutSettings.newValue.SelectTranslatePosition;
});

// this listener activated when document content is loaded
// to make selection button available ASAP
window.addEventListener("DOMContentLoaded", () => {
    // the scrolling elements in pdf files are different from normal web pages
    if (isPDFjsPDFViewer()) {
        // #viewerContainer element is the scrolling element in a pdf file
        scrollingElement = document.getElementById("viewerContainer");
        scrollPropertyX = "scrollLeft";
        scrollPropertyY = "scrollTop";
    }
    // to make the selection icon move with the mouse scrolling
    scrollingElement.addEventListener("scroll", scrollHandler);

    document.addEventListener("mousedown", () => {
        disappearButton();
        // whether user take a select action
        detectSelect(document, (event) => {
            selectTranslate(event);
        });
    });

    document.addEventListener("dblclick", (event) => {
        selectTranslate(event, true);
    });

    document.addEventListener("click", (event) => {
        // triple click
        if (event.detail === 3) {
            selectTranslate(event, true);
        }
    });

    /**
     * implement the select translate feature
     * for the implement detail, please check in the document
     * @param {MouseEvent} event mouse event of mouse up , double click or triple click
     * @param {boolean} isDoubleClick whether the event type is double click or triple click, set false by default
     */
    async function selectTranslate(event, isDoubleClick = false) {
        if (!shouldTranslate()) return;

        const inBlacklist = await isInBlacklist();
        if (inBlacklist) return;

        getOrSetDefaultSettings("OtherSettings", DEFAULT_SETTINGS).then((result) => {
            if (!result.OtherSettings) return;

            let OtherSettings = result.OtherSettings;

            // Show translating result instantly.
            if (
                OtherSettings["TranslateAfterSelect"] ||
                (isDoubleClick && OtherSettings["TranslateAfterDblClick"])
            ) {
                translateSubmit();
            } else if (OtherSettings["SelectTranslate"]) {
                showButton(event);
            }
        });
    }
});

/**
 * 处理鼠标点击按钮事件
 *
 * @param {MouseEvent} event 鼠标点击事件
 */
function buttonClickHandler(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0) {
        translateSubmit();
    }
}

/**
 * 定制功能1：处理鼠标移动到悬浮翻译按钮的事件
 * 鼠标进入按钮区域即直接触发翻译，替代原来的点击触发
 *
 * @param {MouseEvent} event 鼠标进入(mouseenter)事件
 */
function buttonHoverHandler(event) {
    event.preventDefault();
    event.stopPropagation();
    translateSubmit();
}

/**
 * Use this function to show the translation buttion.
 */
function showButton(event) {
    document.documentElement.appendChild(translationButtonContainer);

    const OffsetXValue = 10,
        OffsetYValue = 20;
    let XBias, YBias;
    switch (ButtonPositionSetting) {
        default:
        case "TopRight":
            XBias = OffsetXValue;
            YBias = -OffsetYValue - translationButtonContainer.clientHeight;
            break;
        case "TopLeft":
            XBias = -OffsetXValue - translationButtonContainer.clientWidth;
            YBias = -OffsetYValue - translationButtonContainer.clientHeight;
            break;
        case "BottomRight":
            XBias = OffsetXValue;
            YBias = OffsetYValue;
            break;
        case "BottomLeft":
            XBias = -OffsetXValue - translationButtonContainer.clientWidth;
            YBias = OffsetYValue;
            break;
    }

    let XPosition = event.x + XBias;
    let YPosition = event.y + YBias;

    // If the icon is beyond the side of the page, we need to reposition the icon inside the page.
    if (XPosition <= 0 || XPosition + translationButtonContainer.clientWidth > window.innerWidth)
        XPosition = event.x - XBias - translationButtonContainer.clientWidth;
    if (YPosition <= 0 || YPosition + translationButtonContainer.clientHeight > window.innerHeight)
        YPosition = event.y - YBias - translationButtonContainer.clientHeight;

    // set the new position of the icon
    translationButtonContainer.style.top = `${YPosition}px`;
    translationButtonContainer.style.left = `${XPosition}px`;

    // record original position of the selection icon and the start mouse scrolling position
    originScrollX = scrollingElement[scrollPropertyX];
    originScrollY = scrollingElement[scrollPropertyY];
    originPositionX = XPosition;
    originPositionY = YPosition;
    HasButtonShown = true;
}

/**
 * get selected text and its position in the page
 *
 * @returns {Object} format: {text: "string", position: [p1,p2], selectionHeight: number}
 */
function getSelection() {
    let selection = window.getSelection();
    let text = "";
    let position;
    let selectionHeight = 0;
    if (selection.rangeCount > 0) {
        text = selection.toString().trim();
        if (isPDFjsPDFViewer()) {
            /**
             * pdf.js adds \n at the end of every line and breaks down single sentences into multiple lines.
             * Thus we have to replace \n with space to improve translation.
             */
            text = text.replace(/\n/g, " ");
        }

        const lastRange = selection.getRangeAt(selection.rangeCount - 1);
        // If the user selects something in a shadow dom, the endContainer will be the HTML element and the position will be [0,0]. In this situation, we set the position undefined to avoid relocating the result panel.
        if (lastRange.endContainer !== document.documentElement) {
            let rect = selection.getRangeAt(selection.rangeCount - 1).getBoundingClientRect();
            position = [rect.left, rect.top];
            selectionHeight = rect.height;
        }
    }
    return { text, position, selectionHeight };
}

/**
 * 处理点击翻译按钮后的事件
 */
function translateSubmit() {
    let selection = getSelection();
    if (selection.text && selection.text.length > 0) {
        channel.request("translate", selection).then(() => {
            getOrSetDefaultSettings("OtherSettings", DEFAULT_SETTINGS).then((result) => {
                // to check whether user need to cancel text selection after translation finished
                if (result.OtherSettings && result.OtherSettings["CancelTextSelection"]) {
                    cancelTextSelection();
                }
            });
            disappearButton();
        });
    }
}

/**
 * Check if we should start translating.
 *
 * @returns {boolean} if we should start translating
 */
function shouldTranslate() {
    let selectionObject = window.getSelection();
    let selectionText = selectionObject.toString().trim();
    if (BROWSER_ENV === "firefox")
        // on firefox, we don't need to tell the focusNode type because in input elements, selectionText is ""
        return (
            selectionText.length > 0 &&
            // Do not re-translate translated text.
            !(window.isDisplayingResult && window.translateResult.originalText === selectionText)
        );

    /**
     * Filter out the nodes to avoid the translation button appearing in some unnecessary places.
     * @param {Node} node the node to be filtered
     * @returns {boolean} if the node should be passed
     */
    const filterNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return true;
        // BODY is a special case. see https://github.com/lightrans/lightrans/issues/531
        if (node.nodeType === Node.ELEMENT_NODE) return ["BODY"].includes(node.tagName);
    };

    return (
        selectionText.length > 0 &&
        (filterNode(selectionObject.anchorNode) || filterNode(selectionObject.focusNode)) &&
        // Do not re-translate translated text.
        !(window.isDisplayingResult && window.translateResult.originalText === selectionText)
    );
}


/**
 * execute this function to make the translation button disappear
 */
function disappearButton() {
    if (HasButtonShown) {
        document.documentElement.removeChild(translationButtonContainer);
        HasButtonShown = false;
    }
}

/**
 * the handler function to make the selection icon move with mouse scrolling
 * @param Event the event of scrolling
 */
function scrollHandler() {
    if (HasButtonShown) {
        let distanceX = originScrollX - scrollingElement[scrollPropertyX];
        let distanceY = originScrollY - scrollingElement[scrollPropertyY];

        translationButtonContainer.style.left = `${originPositionX + distanceX}px`;
        translationButtonContainer.style.top = `${originPositionY + distanceY}px`;
    }
}

/**
 * whether the url of current page is in the blacklist
 *
 * @returns {Promise<boolean>} result in promise form
 */
function isInBlacklist() {
    return getOrSetDefaultSettings("blacklist", DEFAULT_SETTINGS).then((result) => {
        let url = window.location.href;
        let blacklist = result.blacklist;
        return blacklist.domains[getDomain(url)] || blacklist.urls[url];
    });
}

/**
 * cancel text selection when translation is finished
 */
function cancelTextSelection() {
    if (window.getSelection) {
        if (window.getSelection().empty) {
            // Chrome
            window.getSelection().empty();
        } else if (window.getSelection().removeAllRanges) {
            // Firefox
            window.getSelection().removeAllRanges();
        }
    } else if (document.selection) {
        // IE
        document.selection.empty();
    }
}

/**
 * 处理取消网页翻译的快捷键
 */
function cancelPageTranslate() {
    let checkAndClick = (button) => {
        if (button !== null && button !== undefined) {
            button.click();
        }
    };

    let frame = document.getElementById(":0.container");
    if (frame !== null && frame !== undefined) {
        let cancelButton = frame.contentDocument.getElementById(":0.close");
        checkAndClick(cancelButton);
    }

    frame = document.getElementById("OUTFOX_JTR_BAR");
    if (frame !== null && frame !== undefined) {
        let cancelButton = frame.contentDocument.getElementById("OUTFOX_JTR_BAR_CLOSE");
        checkAndClick(cancelButton);
    }
}

/**
 * The container of the translation button can be either an iframe or a div with a shadow dom.
 * This function can get the inner parent of the container.
 * @param {HTMLIFrameElement|HTMLDivElement} container
 */
function getInnerParent(container) {
    if (container.tagName === "IFRAME") return container.contentDocument.body;

    if (container.shadowRoot) return container.shadowRoot;

    container.attachShadow({ mode: "open" });
    return container.shadowRoot;
}

// provide user's selection result for the background module
channel.provide("get_selection", () => Promise.resolve(getSelection()));

// handler for shortcut command
channel.on("command", (detail) => {
    switch (detail.command) {
        case "translate_selected":
            translateSubmit();
            break;
        case "cancel_page_translate":
            cancelPageTranslate();
            break;
        default:
            break;
    }
});
