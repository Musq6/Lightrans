/** @jsx h */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useMeasure } from "react-use";
import styled, { css } from "styled-components";
import ArrowDownIcon from "./icons/arrow-down.svg";
import ArrowUpIcon from "./icons/arrow-up.svg";

/**
 *
 * @param {{
 *   DrawerHeight: number;
 *   DisableDrawer?: boolean; // disable the function of drawer
 *   children?: h.JSX.Element;
 * }} props
 * @returns {h.JSX.Element} element
 */
export default function DrawerBlock(props) {
    // Indicate whether the drawer should work or not.
    const [useDrawer, setUseDrawer] = useState(false);
    // Indicate whether the drawer is folded or not.
    const [fold, setFold] = useState(true);

    // Measure the size mutation of the content element.
    const [contentElRef, { height: originalHeight }] = useMeasure();

    useEffect(() => {
        if (props.DisableDrawer || props.DrawerHeight === undefined) {
            setUseDrawer(false);
            return;
        }
        if (originalHeight < props.DrawerHeight) {
            setUseDrawer(false);
        } else {
            setUseDrawer(true);
        }
    }, [props, originalHeight]);

    return (
        <Drawer
            className={props.className}
            height={(() => {
                if (useDrawer) {
                    if (fold) return props.DrawerHeight;
                    return originalHeight + HandleExpandHeight;
                }
                // When not using drawer, let the content fit naturally
                return 'auto';
            })()}
        >
            <Content ref={contentElRef}>{props.children}</Content>
            {useDrawer && (
                <Handle role="button" fold={fold} onClick={() => setFold(!fold)}>
                    {fold ? (
                        <StyledArrowDownIcon title={chrome.i18n.getMessage("ClickToExpand")} />
                    ) : (
                        <StyledArrowUpIcon title={chrome.i18n.getMessage("ClickToFold")} />
                    )}
                </Handle>
            )}
        </Drawer>
    );
}

/**
 * STYLE FOR THE COMPONENT START
 */
const HandleFoldHeight = 40; // Height of the drawer handle when the drawer is folded.
const HandleExpandHeight = 15; // Height of the drawer handler when the drawer is expanded.
const Drawer = styled.div`
    overflow: hidden;
    position: relative;
    transition: height 0.4s;
    ${(props) => (props.height ? `height: ${props.height}` : "")}
`;
const Content = styled.div``;
/**
 * @param {{
 *   fold: boolean; // Whether the drawer is folded.
 * }} props
 */
const Handle = styled.div`
    width: 100%;
    height: ${(props) => (props.fold ? HandleFoldHeight : HandleExpandHeight)}px;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    cursor: pointer;
    /* 渐隐遮罩颜色随「译文显示样式」设置变化；未提供时不做遮罩 */
    background: ${(props) =>
        props.theme.fadeRgb
            ? `linear-gradient(transparent 0%, rgba(${props.theme.fadeRgb}, 0.4) 30%, rgb(${props.theme.fadeRgb}) 100%)`
            : "none"};
    ${(props) => (props.fold ? "position: absolute; bottom: 0;" : "")}

    &:hover {
        background: ${(props) =>
            props.theme.fadeRgb
                ? `linear-gradient(transparent 0%, rgba(${props.theme.fadeRgb}, 0.7) 30%, rgb(${props.theme.fadeRgb}) 100%)`
                : "none"};
    }

    &:hover svg {
        fill: #4a8cf7;
    }
`;
const iconStyle = (props) => css`
    width: 20px;
    height: 20px;
    fill: ${props.theme.secondaryColor};
`;
const StyledArrowDownIcon = styled(ArrowDownIcon)`
    ${(props) => iconStyle(props)};
`;
const StyledArrowUpIcon = styled(ArrowUpIcon)`
    ${(props) => iconStyle(props)};
    height: ${HandleExpandHeight}px;
`;
/**
 * STYLE FOR THE COMPONENT END
 */
