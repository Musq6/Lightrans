/** @jsx h */
import { h, Fragment } from "preact";
import { useEffect, useRef, useReducer, useState } from "preact/hooks";
import styled, { ThemeProvider } from "styled-components";
import Channel from "common/scripts/channel.js";
import { DEFAULT_SETTINGS, getOrSetDefaultSettings } from "common/scripts/settings.js";
import Notifier from "./library/notifier/notifier.js";
import DOMPurify from "dompurify";
import { checkTimestamp } from "./Panel.jsx";
import DrawerBlock from "./DrawerBlock.jsx";
import { fs, FONT_SCALE } from "./displayStyle.js";
import EditIcon from "./icons/edit.svg";
import EditDoneIcon from "./icons/edit-done.svg";
import CopyIcon from "./icons/copy.svg";

// Communication channel.
const channel = new Channel();
const notifier = new Notifier("center");

/**
 * @param {{
 *   mainMeaning: string;
 *   originalText: string;
 *   tPronunciation?: string;
 *   sPronunciation?: string;
 *   detailedMeanings?: Array<{
 *     pos: string;
 *     meaning: string;
 *     synonyms?: Array<string>;
 *   }>;
 *   definitions?: Array<{
 *     pos: string;
 *     meaning: string;
 *     synonyms?: Array<string>;
 *     example?: string;
 *   }>;
 *   examples?: Array<{
 *     source?: string;
 *     target?: string;
 *   }>;
 * }} props translate result
 *
 * @returns {h.JSX.Element} element
 */
export default function Result(props) {
    /**
     * The order state of displaying contents.
     */
    const [contentDisplayOrder, setContentDisplayOrder] = useState([]);

    /**
     * The visible state of contents.
     */
    const [contentFilter, setContentFilter] = useState({});

    /**
     * Text direction state.
     */
    const [textDirection, setTextDirection] = useState("ltr");

    /**
     * Whether to fold too long translation content.
     */
    const [foldLongContent, setFoldLongContent] = useState(true);

    // Indicate whether user can edit and copy the translation result
    const [copyResult, setCopyResult] = useReducer(copyContent, false);
    const translateResultElRef = useRef();

    // Indicate whether user is editing the original text
    const [editing, setEditing] = useReducer(_setEditing, false);
    const originalTextElRef = useRef();

    const TargetContent = (
        <Fragment key={"mainMeaning"}>
            {props.mainMeaning?.length > 0 && (
                <Target>
                    <TextLine>
                        <div
                            dir={textDirection}
                            contenteditable={copyResult}
                            onBlur={() => setCopyResult({ copy: false })}
                            ref={translateResultElRef}
                            style={{ paddingLeft: 3 }}
                        >
                            {props.mainMeaning}
                        </div>
                        <StyledCopyIcon
                            role="button"
                            onClick={() =>
                                setCopyResult({
                                    copy: true,
                                    element: translateResultElRef.current,
                                })
                            }
                            title={chrome.i18n.getMessage("CopyResult")}
                        />
                    </TextLine>
                </Target>
            )}
        </Fragment>
    );

    const SourceContent = (
        <Fragment key={"originalText"}>
            {props.originalText?.length > 0 && (
                <Source>
                    <TextLine>
                        <div
                            dir={textDirection}
                            contenteditable={editing}
                            ref={originalTextElRef}
                            style={{ paddingLeft: 3 }}
                        >
                            {props.originalText}
                        </div>
                        {editing ? (
                            <StyledEditDoneIcon
                                role="button"
                                title={chrome.i18n.getMessage("Retranslate")}
                                onClick={() =>
                                    setEditing({
                                        edit: false,
                                        element: originalTextElRef.current,
                                    })
                                }
                            />
                        ) : (
                            <StyledEditIcon
                                role="button"
                                title={chrome.i18n.getMessage("EditText")}
                                onClick={() =>
                                    setEditing({
                                        edit: true,
                                        element: originalTextElRef.current,
                                    })
                                }
                            />
                        )}
                    </TextLine>
                </Source>
            )}
        </Fragment>
    );

    const DetailContent = (
        <Fragment key={"detailedMeanings"}>
            {props.detailedMeanings?.length > 0 && (
                <Detail>
                    <BlockHead>
                        <DetailHeadSpot />
                        <BlockHeadTitle>
                            {chrome.i18n.getMessage("DetailedMeanings")}
                        </BlockHeadTitle>
                        <BlockSplitLine />
                    </BlockHead>
                    <BlockContent
                        DrawerHeight={BlockContentDrawerHeight}
                        DisableDrawer={!foldLongContent}
                    >
                        {props.detailedMeanings.map((detail, detailIndex) => (
                            <Fragment key={`detail-${detailIndex}`}>
                                <Position dir={textDirection}>{detail.pos}</Position>
                                <DetailMeaning dir={textDirection}>{detail.meaning}</DetailMeaning>
                                {detail.synonyms?.length > 0 && (
                                    <Fragment>
                                        <SynonymTitle dir={textDirection}>
                                            {chrome.i18n.getMessage("Synonyms")}
                                        </SynonymTitle>
                                        <SynonymLine>
                                            {detail.synonyms.map((word, synonymIndex) => (
                                                <SynonymWord
                                                    key={`detail-synonym-${synonymIndex}`}
                                                    dir={textDirection}
                                                >
                                                    {word}
                                                </SynonymWord>
                                            ))}
                                        </SynonymLine>
                                    </Fragment>
                                )}
                            </Fragment>
                        ))}
                    </BlockContent>
                </Detail>
            )}
        </Fragment>
    );

    const DefinitionContent = (
        <Fragment key={"definitions"}>
            {props.definitions?.length > 0 && (
                <Definition>
                    <BlockHead>
                        <DefinitionHeadSpot />
                        <BlockHeadTitle>{chrome.i18n.getMessage("Definitions")}</BlockHeadTitle>
                        <BlockSplitLine />
                    </BlockHead>
                    <BlockContent
                        DrawerHeight={BlockContentDrawerHeight}
                        DisableDrawer={!foldLongContent}
                    >
                        {props.definitions.map((definition, definitionIndex) => (
                            <Fragment key={`definition-${definitionIndex}`}>
                                <Position dir={textDirection}>{definition.pos}</Position>
                                <DetailMeaning dir={textDirection}>
                                    {definition.meaning}
                                </DetailMeaning>
                                {definition.example && (
                                    <DefinitionExample
                                        dir={textDirection}
                                    >{`"${definition.example}"`}</DefinitionExample>
                                )}
                                {definition.synonyms?.length > 0 && (
                                    <Fragment>
                                        <SynonymTitle dir={textDirection}>
                                            {chrome.i18n.getMessage("Synonyms")}
                                        </SynonymTitle>
                                        <SynonymLine>
                                            {definition.synonyms.map((word, synonymIndex) => (
                                                <SynonymWord
                                                    key={`definition-synonym-${synonymIndex}`}
                                                    dir={textDirection}
                                                >
                                                    {word}
                                                </SynonymWord>
                                            ))}
                                        </SynonymLine>
                                    </Fragment>
                                )}
                            </Fragment>
                        ))}
                    </BlockContent>
                </Definition>
            )}
        </Fragment>
    );

    const ExampleContent = (
        <Fragment key={"examples"}>
            {props.examples?.length > 0 && (
                <Example>
                    <BlockHead>
                        <ExampleHeadSpot />
                        <BlockHeadTitle>{chrome.i18n.getMessage("Examples")}</BlockHeadTitle>
                        <BlockSplitLine />
                    </BlockHead>
                    <BlockContent
                        DrawerHeight={BlockContentDrawerHeight}
                        DisableDrawer={!foldLongContent}
                    >
                        <ExampleList dir={textDirection}>
                            {props.examples.map((example, index) => (
                                <ExampleItem key={`example-${index}`}>
                                    {example.source && (
                                        <ExampleSource
                                            dangerouslySetInnerHTML={{
                                                __html: DOMPurify.sanitize(example.source, {
                                                    ALLOWED_TAGS: ["b"],
                                                }),
                                            }}
                                        />
                                    )}
                                    {example.target && (
                                        <ExampleTarget
                                            // eslint-disable-next-line react/no-danger
                                            dangerouslySetInnerHTML={{
                                                __html: DOMPurify.sanitize(example.target, {
                                                    ALLOWED_TAGS: ["b"],
                                                }),
                                            }}
                                        />
                                    )}
                                </ExampleItem>
                            ))}
                        </ExampleList>
                    </BlockContent>
                </Example>
            )}
        </Fragment>
    );

    /**
     * Content maps.
     */
    const CONTENTS = {
        mainMeaning: TargetContent,
        originalText: SourceContent,
        detailedMeanings: DetailContent,
        definitions: DefinitionContent,
        examples: ExampleContent,
    };

    useEffect(() => {
        /*
         * COMMUNICATE WITH BACKGROUND MODULE
         */
        const cancelers = [];
        cancelers.push(
            channel.on("command", (detail) => {
                switch (detail.command) {
                    case "copy_result":
                        if (window.translateResult?.mainMeaning && translateResultElRef.current) {
                            setCopyResult({ copy: true, element: translateResultElRef.current });
                        }
                        break;
                    default:
                        break;
                }
            })
        );

        /**
         * Update displaying contents based on user's setting.
         */
        getOrSetDefaultSettings(
            ["LayoutSettings"],
            DEFAULT_SETTINGS
        ).then((result) => {
            // Set default content filter values
            setContentFilter({
                mainMeaning: true,
                // 定制功能2：划词翻译结果只显示译文，不显示原文
                originalText: false,
                detailedMeanings: true,
                definitions: true,
                examples: true
            });
            // Set default content display order
            setContentDisplayOrder(["mainMeaning", "originalText", "detailedMeanings", "definitions", "examples"]);
            // Set layout settings
            setTextDirection(result.LayoutSettings.RTL ? "rtl" : "ltr");
            setFoldLongContent(result.LayoutSettings.FoldLongContent);
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "sync") return;

            if (changes.LayoutSettings) {
                setTextDirection(changes.LayoutSettings.newValue.RTL ? "rtl" : "ltr");
                setFoldLongContent(changes.LayoutSettings.newValue.FoldLongContent);
            }
        });

        return () => {
            // remove all of event listeners before destroying the component
            cancelers.forEach((canceler) => canceler());
        };
    }, []);

    return (
        <Fragment>
            <ThemeProvider theme={(props) => ({ ...props, textDirection })}>
                {contentDisplayOrder
                    .filter((content) => contentFilter[content])
                    .map((content) => CONTENTS[content])}
            </ThemeProvider>
        </Fragment>
    );
}

/**
 * STYLE FOR THE COMPONENT START
 */

const BlockPadding = "10px";
const BlockMargin = "8px";
const LightPrimary = "rgba(74, 140, 247, 0.7)";
const BlockContentDrawerHeight = 150; // drawer height for blocks
const TextContentDrawerHeight = 50; // drawer height for texts

/**
 * basic style for a block used to display content
 *
 * 底色 / 边框 / 圆角 / 阴影来自「译文显示样式」设置
 */
export const Block = styled.div`
    width: calc(100% - 2 * ${BlockMargin});
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    padding: ${BlockPadding};
    margin: ${BlockMargin};
    margin-top: 0;
    background-color: ${(props) => props.theme.blockBg};
    border: ${(props) => props.theme.blockBorder};
    border-radius: ${(props) => props.theme.blockRadius}px;
    box-shadow: ${(props) => props.theme.blockShadow};
    line-height: 130%;
    letter-spacing: 0.01em;
    min-height: auto;
    max-height: none;
`;

const Source = styled(Block)`
    font-weight: normal;
    white-space: pre-wrap;
    border-left: 3px solid ${(props) => props.theme.hairline};
`;

const Target = styled(Block)`
    font-weight: 500;
    white-space: pre-wrap;
    border-left: 3px solid ${LightPrimary};
`;

const Detail = styled(Block)`
    font-weight: normal;
`;

const TextLine = styled.div`
    width: 100%;
    display: flex;
    margin: 5px 0;
    flex-direction: ${(props) => (props.theme.textDirection === "ltr" ? "row" : "row-reverse")};
    justify-content: space-between;
    align-items: center;
`;

const StyledEditIcon = styled(EditIcon)`
    width: 18px;
    height: 18px;
    fill: ${(props) => props.theme.secondaryColor};
    flex-shrink: 0;
    margin-left: 2px;
    transition: fill 0.2s linear;
        &:hover {
            fill: #4a8cf7;
        }
`;

const StyledEditDoneIcon = styled(EditDoneIcon)`
    width: 18px;
    height: 18px;
    fill: ${(props) => props.theme.secondaryColor};
    flex-shrink: 0;
    margin-left: 2px;
    transition: fill 0.2s linear;
        &:hover {
            fill: #4a8cf7;
        }
`;

const StyledCopyIcon = styled(CopyIcon)`
    width: 20px;
    height: 20px;
    fill: ${(props) => props.theme.secondaryColor};
    flex-shrink: 0;
    margin-left: 2px;
    transition: fill 0.2s linear;
        &:hover {
            fill: #4a8cf7;
        }
`;

const BlockHead = styled.div`
    width: 100%;
    display: flex;
    flex-direction: ${(props) => (props.theme.textDirection === "ltr" ? "row" : "row-reverse")};
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: center;
`;

const BlockHeadTitle = styled.span`
    font-size: ${fs(FONT_SCALE.small)};
    ${(props) =>
        `${props.theme.textDirection === "ltr" ? "margin-left" : "margin-right"}:${BlockPadding}`}
`;

/**
 * common style for the spot of block head
 */
const BlockHeadSpot = styled.span`
    width: 10px;
    height: 10px;
    border-radius: 50%;
`;

const BlockSplitLine = styled.div`
    width: 100%;
    height: 1px;
    margin: 5px 0;
    flex-shrink: 0;
    border: none;
    background: ${(props) => props.theme.hairlineStrong};
`;

const BlockContent = styled(DrawerBlock)`
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: ${(props) => (props.theme.textDirection === "ltr" ? "flex-start" : "flex-end")};
    flex-shrink: 0;
`;

const DetailHeadSpot = styled(BlockHeadSpot)`
    background-color: #00bfa5;
`;

const Position = styled.div`
    color: ${(props) => props.theme.secondaryColor};
    font-size: ${fs(FONT_SCALE.small)};
`;

const DetailMeaning = styled.div`
    padding: 5px 0;
    ${(props) => (props.theme.textDirection === "ltr" ? "margin-left" : "margin-right")}: 10px;
`;

const SynonymTitle = styled.div`
    color: ${(props) => props.theme.secondaryColor};
    font-size: ${fs(FONT_SCALE.small)};
    ${(props) => (props.theme.textDirection === "ltr" ? "margin-left" : "margin-right")}: 10px;
`;

const SynonymLine = styled.div`
    display: flex;
    flex-wrap: wrap;
    padding: 5px 0;
    ${(props) =>
        props.theme.textDirection === "ltr"
            ? `
                margin-left: 10px;
                flex-direction: row;
            `
            : `
                margin-right: 10px;       
                flex-direction: row-reverse;
            `};
`;

const SynonymWord = styled.span`
    padding: 2px 10px;
    margin: 0 2px 3px;
    border: 1px solid ${(props) => props.theme.hairline};
    border-radius: 32px;
    cursor: pointer;
    font-size: ${fs(FONT_SCALE.small)};
`;

const Definition = styled(Block)``;

const DefinitionHeadSpot = styled(BlockHeadSpot)`
    background-color: #ff4081;
`;

const DefinitionExample = styled(DetailMeaning)`
    color: ${(props) => props.theme.secondaryColor};
`;

const Example = styled(Block)``;

const ExampleHeadSpot = styled(BlockHeadSpot)`
    background-color: #3d5afe;
`;

const ExampleList = styled.ol`
    list-style-type: decimal;
    ${(props) => (props.theme.textDirection === "ltr" ? "padding-left" : "padding-right")}: 1.5rem;
    margin: 0;
`;

const ExampleItem = styled.li`
    padding: 5px 0;
    font-size: ${fs(FONT_SCALE.small)};
`;

const ExampleSource = styled.div`
    font-size: ${fs(FONT_SCALE.medium)};
`;

const ExampleTarget = styled.div`
    padding-top: 5px;
    font-size: ${fs(FONT_SCALE.medium)};
`;

/**
 * STYLE FOR THE COMPONENT END
 */



/**
 * A reducer for copying state of translation result
 * @param {*} _
 * @param {
 *     copy: boolean;  // new state
 *     element: HTMLElement; // the element for displaying translation results
 * } action
 */
function copyContent(_, action) {
    if (action.copy && action.element && action.element.setAttribute) {
        /**
         * This line is to make sure the div element is editable before the focus action.
         * Because of the react mechanism, contenteditable={copyResult} will work after this function is executed.
         */
        action.element.setAttribute("contenteditable", "true");

        action.element.focus();

        // select all content automatically
        let range = document.createRange();
        range.selectNodeContents(action.element);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);

        document.execCommand("copy");
    } else if (!action.copy) window.getSelection().removeAllRanges();
    return action.copy;
}

/**
 * The following 4 functions are intended to prevent input events from being caught by other elements.
 */

/**
 * Prevent keydown event from propagation.
 *
 * @param {Event} event keydown event.
 */
function onKeyDownInTextEditor(event) {
    event.stopPropagation();
}

/**
 * Prevent keyup event from propagation.
 *
 * @param {Event} event keyup event.
 */
function onKeyUpInTextEditor(event) {
    event.stopPropagation();
}

/**
 * When the input box gets focused, prevent input events from propagation.
 *
 * @param {Event} event focus event.
 */
function onTextEditorFocused(event) {
    event.target.addEventListener("keydown", onKeyDownInTextEditor);
    event.target.addEventListener("keyup", onKeyUpInTextEditor);
}

/**
 * When the input box gets blurred, allow input events propagation.
 *
 * @param {Event} event blur event.
 */
function onTextEditorBlurred(event) {
    event.target.removeEventListener("keydown", onKeyDownInTextEditor);
    event.target.removeEventListener("keyup", onKeyUpInTextEditor);
}

/**
 * Edit original text.
 *
 * @param {HTMLElement} originalTextEle original text element
 */
function editOriginalText(originalTextEle) {
    // Prevent input events from propagation.
    originalTextEle.addEventListener("focus", onTextEditorFocused);
    originalTextEle.addEventListener("blur", onTextEditorBlurred);

    /**
     * Make the editable element automatically focus.
     * Use setTimeout because of https://stackoverflow.com/a/37162116.
     */
    setTimeout(() => originalTextEle.focus());
}

/**
 * Submit and translate edited text.
 *
 * @param {HTMLElement} originalTextEle original text element
 */
function submitEditedText(originalTextEle) {
    // Allow input events propagation.
    originalTextEle.removeEventListener("focus", onTextEditorFocused);
    originalTextEle.removeEventListener("blur", onTextEditorBlurred);

    let text = originalTextEle.textContent.trim();
    if (text.length > 0) {
        // to make sure the new text is different from the original text
        if (window.translateResult && text.valueOf() !== window.translateResult.originalText?.valueOf()) {
            // Do translating.
            channel.request("translate", { text });
        }
    } else if (window.translateResult) {
        // Restore original text.
        originalTextEle.textContent = window.translateResult.originalText;
    }
}

/**
 * A reducer for updating editing state of original text.
 *
 * @param {any} _ nothing
 * @param {{edit: boolean; element: HTMLElement;}} state new state information
 * @returns new state
 */
function _setEditing(_, state) {
    if (state.element) {
        if (state.edit) {
            editOriginalText(state.element);
        } else {
            submitEditedText(state.element);
        }
    }
    return state.edit;
}
