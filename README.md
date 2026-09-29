# Lightrans

一个轻量级的浏览器 AI 翻译扩展，基于 EdgeTranslate 开发，为 Chrome 和 Firefox 浏览器提供无缝的翻译服务，由[硅基流动](https://siliconflow.cn/)提供 api 支持。

> 本仓库是基于上游 Lightrans 的**个人定制分支**，在保留原有功能的前提下调整了划词翻译的交互体验，改动细节见 [本分支定制说明](#本分支定制说明)。

Lightrans 网页版已上线，项目地址：[Lightrans_web](https://github.com/W4J1e/lightran_web) ,在线[demo](https://trans.hin.cool/)。

*特别提醒：本项目默认使用 Lightrans_web 同一个中继 API，源代码完全公开，但该服务不属于本项目开源的一部分。*

## 本分支定制说明

相对上游，本分支只改动了**划词翻译**（选中文字后弹出的悬浮按钮）的交互，其余功能与上游保持一致。

### 1. 悬浮按钮悬停即翻译

上游需要**鼠标点击**悬浮按钮才开始翻译；本分支改为**鼠标移动到按钮上直接触发翻译**，无需点击。

- 改动位置：`packages/lightrans/src/content/select/select.js`
- 实现：在 `renderButton()` 中为悬浮按钮新增 `mouseenter` 监听（`buttonHoverHandler`）。原有的 `mousedown` 监听保留作为兜底——翻译完成后按钮会被移除，因此不会重复触发。

### 2. 划词结果不显示原文

划词翻译的结果面板**只显示译文**，不再显示原文，原有的「编辑原文」入口一并移除。

- 改动位置：`packages/lightrans/src/content/display/Result.jsx`
- 实现：`setContentFilter()` 中 `originalText` 由 `true` 改为 `false`。
- 影响范围：仅划词结果面板（`Result` 组件只被 `Panel.jsx` 引用）；弹窗翻译与整页翻译不受影响。

## 功能特性

- **跨浏览器支持**：支持 Chrome 和 Firefox
- **AI 驱动翻译**：使用轻量的 AI 模型提供准确的翻译
- **上下文菜单集成**：易于使用的上下文菜单，方便快速翻译
- **整页翻译**：支持完整的页面翻译
- **多语言支持**：英语、中文（简体）、中文（繁体）、日语
- **PDF 翻译**：支持 PDF 文件的翻译

## 安装说明

### Chrome
1. 构建 Chrome 版本（产物位于 `packages/lightrans/build/chrome/`）
2. 打开 Chrome 浏览器，导航到 `chrome://extensions/`
3. 启用右上角的 "开发者模式"
4. 点击 "加载已解压的扩展程序"，选择 `packages/lightrans/build/chrome/` 目录
5. 扩展将成功加载

### Firefox
1. 构建 Firefox 版本
2. 打开 Firefox 浏览器，导航到 `about:debugging#/runtime/this-firefox`
3. 点击 "临时载入附加组件"，选择 Firefox 构建目录中的 `manifest.json`
4. 扩展将成功加载

## 翻译服务模式

扩展支持两种翻译服务模式，可在设置页切换：

- **free（默认）**：走作者部署的中继 API（`https://trans.hin.cool/api/translate`），内置共享令牌，零配置、无需 API Key。
- **custom**：直连硅基流动官方接口（`https://api.siliconflow.cn/v1/chat/completions`），使用自己的 API Key。

> ⚠️ 如果翻译持续提示「翻译失败」，通常是默认的中继服务暂时不可用（限流或下线）。此时切换到 **custom** 模式并填入自己的硅基流动 API Key 即可恢复。

## 开发指南

本仓库由两个 package 组成，且**存在构建先后依赖**：

- `packages/translators`：翻译请求层（TypeScript + Vite，产出 `dist/translators.*.js`）
- `packages/lightrans`：扩展本体（Preact + Gulp + Webpack，产出 `build/<browser>/`）

由于扩展通过别名引用 `packages/translators` 的构建产物，必须**先构建 translators**。

### 构建

```bash
# 1. 先构建 translators
npm install --prefix packages/translators --legacy-peer-deps --ignore-scripts
npm run build --prefix packages/translators

# 2. 再构建扩展本体
npm install --prefix packages/lightrans --legacy-peer-deps --ignore-scripts
npm run build:chrome      # 产物：packages/lightrans/build/chrome/
npm run build:firefox     # 产物：packages/lightrans/build/firefox/
```

说明：

- `--ignore-scripts` 用于跳过 `chromedriver` / `geckodriver` 的驱动下载脚本。
- `--legacy-peer-deps` 用于绕过 Preact / React 兼容层的 peer 依赖冲突。

### 打包为 zip

```bash
npm run pack:chrome    # 额外生成 packages/lightrans/build/lightrans_chrome.zip
npm run pack:firefox
```

### 开发模式（自动监听重建）

```bash
npm run dev:chrome --prefix packages/lightrans
npm run dev:firefox --prefix packages/lightrans
```

## 鸣谢

本项目是 [EdgeTranslate](https://github.com/EdgeTranslate/EdgeTranslate) 的分支和修改版本，扩展了其功能并提高了性能。

感谢[<img src="doc/SiliconFlow.png" alt="SiliconFlow" height="20">](https://siliconflow.cn/)提供 api 支持，本项目的基础功能才能得以实现。

## 许可证

MIT License
