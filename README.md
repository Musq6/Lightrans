# Lightrans

一个轻量级的浏览器 AI 翻译扩展，基于 EdgeTranslate 开发，为 Chrome 和 Firefox 浏览器提供无缝的翻译服务，由[硅基流动](https://siliconflow.cn/)提供 api 支持。

> 本仓库是基于上游 Lightrans 的**个人定制分支**，在保留原有功能的前提下调整了交互并新增了可配置的显示样式。
> 本 README 只说明**用户可见的行为**；每项改动的动机与实现细节记录在对应的 git 提交信息中（提交标题与本节的条目一一对应）。

Lightrans 网页版已上线，项目地址：[Lightrans_web](https://github.com/W4J1e/lightran_web) ,在线[demo](https://trans.hin.cool/)。

*特别提醒：本项目默认使用 Lightrans_web 同一个中继 API，源代码完全公开，但该服务不属于本项目开源的一部分。*

## 本分支定制说明

相比上游，本分支做了以下调整，其余功能与上游保持一致。

### 1. 悬浮按钮悬停即翻译

选中文字后，**鼠标移动到悬浮按钮上即开始翻译**，无需点击。

### 2. 划词结果只显示译文

划词翻译的结果面板**只显示译文**，不再重复显示原文。

### 3. 整页翻译菜单更直接

右键菜单点击「翻译此页面」后**直接使用设置中选定的模型**开始翻译，不再需要在其二级菜单里挑选模型。

### 4. 可自定义的译文显示样式

设置页新增两个**相互独立**的样式分组，各设置各的、互不影响。

- **划词结果框样式**（选中文字后弹出的译文面板）：面板外观、文字颜色、字号、圆角、阴影。修改后**立即生效**，无需刷新页面。
- **整页翻译译文样式**（「对照」模式下插入页面的那一段译文）：译文外观、强调色、字号、圆角、深色网页适配。

说明：

- 「下划线」「纯文字」两种外观不带底色，文字颜色直接继承网页原文，因此在任何配色的网页上都不会有对比度问题。
- 改划词结果框样式不会影响整页翻译的译文，反之亦然。

### 5. 自定义第三方服务商

新增第三种服务模式：**自定义服务商**，可添加任意多个第三方服务商并分别配置，划词结果框顶部的下拉也会列出这些「服务商 · 模型」组合。

只要服务商提供 OpenAI 兼容的 `/chat/completions` 接口即可接入（OpenAI、DeepSeek、月之暗面、智谱、通义、火山方舟、OpenRouter、本地 Ollama 等）。接口地址填到域名或 `/v1` 都行，缺少的路径会自动补全；带查询参数的地址（如 Azure 的 `?api-version=...`）原样保留。

说明：

- 一个服务商可以配置多个模型，各自独立。
- 额外请求头用于适配以 `x-api-key` 等非标准方式鉴权的服务商；若自己填了 `Authorization` 头，扩展不会再注入 `Bearer <API Key>`。
- 所选服务商缺地址或没有模型时会直接报出原因，**不会**悄悄改用其它服务商。
- 配置随浏览器账号同步；从旧版本升级时，原先的单个模型会保留为模型列表的第一项。

### 6. 修复

- **整页翻译显示模式**：翻译过程中在「显示原网页 / 显示译文 / 对照」之间切换，不再被后续到达的译文覆盖回初始模式。
- **划词结果框字号**：字号设置现在真正生效，面板内所有文字会随档位整体缩放。

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

### Firefox
1. 构建 Firefox 版本
2. 打开 Firefox 浏览器，导航到 `about:debugging#/runtime/this-firefox`
3. 点击 "临时载入附加组件"，选择 Firefox 构建目录中的 `manifest.json`

## 翻译服务模式

扩展支持三种翻译服务模式：

- **free（默认）**：走作者部署的中继 API（`https://trans.hin.cool/api/translate`），内置共享令牌，零配置、无需 API Key。
- **custom**：直连硅基流动官方接口（`https://api.siliconflow.cn/v1/chat/completions`），使用自己的 API Key。
- **provider（自定义服务商）**：接入自己添加的任意 OpenAI 兼容第三方接口，每个服务商独立配置接口地址、API Key 与模型。用法见 [本分支定制说明](#本分支定制说明) 第 5 节。

> ⚠️ 如果翻译持续提示「翻译失败」，通常是默认的中继服务暂时不可用（限流或下线）。此时切换到 **custom** 模式并填入自己的硅基流动 API Key，或改用 **provider** 模式接入自己的服务商，即可恢复。

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
