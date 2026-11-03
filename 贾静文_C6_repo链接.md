# 贾静文_C6_repo链接

## 源码地址

**https://github.com/ZayneWenner/C6-Deliverable-Checker**

公开仓库（public），main 分支，GitHub Pages 直接从 main 部署。

## 仓库结构

```
C6-Deliverable-Checker/
├── index.html              # 页面骨架：三步式流程 + 结果面板 + AI 设置弹窗
├── assets/
│   ├── styles.css          # 全部样式（原生 CSS，无框架，含响应式断点）
│   ├── data.js             # 内置 20 个挑战的交付物模式数据（window.CHALLENGE_DATA）
│   ├── engine.js           # 规则引擎：通配符匹配、命中/缺失判定、空文件检测、命名提示
│   ├── app.js              # 交互层：选挑战、拖拽/选文件夹、渲染、报告导出、示例数据
│   └── ai.js               # AI 层：配置存取、提示词构造、OpenAI/Anthropic 双协议调用
├── test/
│   └── engine.test.js      # 引擎回归测试（node test/engine.test.js，32 条断言）
├── demo/
│   ├── 01-home-desktop.png # 桌面首屏
│   ├── 02-home-mobile.png  # 手机首屏（390px 视口）
│   ├── 03-check-mixed.png  # 混合场景校验结果
│   ├── 04-check-pass.png   # 全命中场景
│   └── 05-check-mobile.png # 手机端结果页
├── 贾静文_C6_app链接.md
├── 贾静文_C6_repo链接.md
├── 贾静文_C6_AI日志.md
├── 贾静文_C6_拿来说明.md
├── 贾静文_C6_demo.mp4      # 46 秒演示视频
├── README.md
├── LICENSE                 # MIT
└── .nojekyll               # 关闭 Jekyll，保证 assets 原样发布
```

## 如何本地跑起来

不需要 npm install、不需要构建、不需要后端：

```bash
git clone https://github.com/ZayneWenner/C6-Deliverable-Checker.git
cd C6-Deliverable-Checker
# 直接双击 index.html 即可；
# 需要本地服务时（用于测试文件夹拖拽等能力）：
python -m http.server 8000
# 打开 http://localhost:8000
```

跑规则引擎的回归测试：

```bash
node test/engine.test.js
```

## 关键实现说明

**规则引擎（engine.js）** —— 完全不依赖 AI，纯确定性逻辑，因此可测试、结果可复现：

- 单个 `*` 通配符匹配（平台交付物模式的写法，如 `*AI日志*`）；
- 「必须连续」判定：`AI日志` 命中，`AI协作日志` 不命中——这是我真实踩过的坑，写进了规则；
- 0 字节文件单独标记为「文件为空」，不算命中（空文件等于没交）；
- 未命中文件反向给出「疑似应改名为 X」的提示；
- 支持子目录路径（用 `webkitdirectory` 递归读取，避免"文件在但放在子文件夹里"的误判）。

**AI 层（ai.js）** —— 不是装饰性按钮：

- 输入：规则引擎判定为「没被用上」的文件（文件名 + 前 4000 字内容）+ 该挑战的交付物模式；
- 任务：判断这个文件其实属于哪一类交付物、或者判断它确实无用、并给出整改动作；
- 输出：结构化 JSON（强制模型返回 JSON，代码侧做 fence 剥离与首尾大括号兜底解析）；
- 协议：兼容 OpenAI 格式（`/chat/completions`）与 Anthropic 格式（`/v1/messages`），用户可自填 base URL，因此可对接任何兼容端点；
- 超时：45 秒 AbortController 中断，失败时降级为「规则校验结果照常展示」而不是整页报错。

**API Key 处理** —— 没有硬编码。Key 只保存在使用者自己浏览器的 `localStorage`（键 `dc_ai_cfg_v1`），请求从浏览器直连模型服务商，不经过任何中间服务器；设置面板提供一键清除。

## 交付物对应

| 平台要求 | 文件 |
|---------|------|
| `*app链接*` | `贾静文_C6_app链接.md` → https://zaynewenner.github.io/C6-Deliverable-Checker/ |
| `*demo*` | `贾静文_C6_demo.mp4`（46 秒，1280×720，H.264）+ `demo/` 内 5 张真实渲染截图 |
| `*repo链接*` | 本文件 |
| `*AI日志*` | `贾静文_C6_AI日志.md` |
| 拿来说明 / ATTRIBUTION | `贾静文_C6_拿来说明.md` |
