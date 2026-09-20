# 执行记录

本文件记录实际实施与验证证据；未运行的真实环境验收不得写成通过。

状态仅使用 TODO / DOING / PASS / BLOCKED。PASS 必须附真实证据。

| 任务 | 状态 | 提交 | 测试与证据 | 限制/未运行 |
|---|---|---|---|---|
| T00 | PASS | 本任务提交 | `npm ci`; `npm run build`; `node scripts/probe-ankiconnect.mjs`; 入口/AI/TTS/浏览器审计见 BASELINE.md、CAPABILITIES.md | AnkiConnect不可达；Firefox未安装；真实音频导出未运行 |
| T01 | PASS | 本任务提交 | `npm run test:anki`（6/6）；连续构建；watch重编译；Chromium 150加载dist并核实后台listener、content facade | Firefox未安装；正式Chrome 153自动加载受发行版命令行限制，使用同机Chromium实测 |
| T02 | PASS | 本任务提交 | `npm run test:anki`：14组固定identity vectors及offset/Unicode/message边界全部通过 | 无 |
| T03 | TODO | — | — | — |
| T04 | TODO | — | — | — |
| T05 | TODO | — | — | — |
| T06 | TODO | — | — | — |
| T07 | TODO | — | — | — |
| T08 | TODO | — | — | — |
| T09 | TODO | — | — | — |
| T10 | TODO | — | — | — |
| T11 | TODO | — | — | — |
| T12 | TODO | — | — | — |
| T13 | TODO | — | — | — |
| T14 | TODO | — | — | — |
| T15 | TODO | — | — | — |
| T16 | TODO | — | — | — |
| T17 | TODO | — | — | — |
| T18 | TODO | — | — | — |
| T19 | TODO | — | — | — |
| T20 | TODO | — | — | — |
| T21 | TODO | — | — | — |

## 单任务交付模板

### Txx

实际基线：
修改文件：
行为变化：
测试命令：
实际结果：
未运行的验收：
回归检查：
提交：
下一任务：

### T00

实际基线：`main` @ `b9103a196ca15f3789588098ae858d3224e1468a`，开始时工作区干净；Node `v24.19.0`，npm `11.14.1`。
修改文件：`docs/anki-phase1/BASELINE.md`、`docs/anki-phase1/CAPABILITIES.md`、`scripts/probe-ankiconnect.mjs`、本记录。
行为变化：仅增加审计记录和只读 AnkiConnect 探测脚本；没有业务功能或真实 Anki 写入。
测试命令：`npm ci`；`npm run build`；`node scripts/probe-ankiconnect.mjs`。
实际结果：依赖安装成功；Webpack 5.98.0 构建成功（仅原有体积警告）；探测脚本按预期报告本机 `127.0.0.1:8765` 不可达。Chrome `153.0.8010.50`、Edge `154.0.4258.24` 可用于后续加载测试。
未运行的验收：A01 的真实协议/方法/返回形状、Firefox、真实音频导出；均明确保持未验证。
回归检查：A00 可由 BASELINE.md 的入口图与构建命令复查；T00 未改运行时代码。
提交：本任务提交。
下一任务：T01，建立隔离模块、加载桥接与测试框架。

### T01

实际基线：T00 已通过；遗留 Webpack 使用 classic-script 多入口与 `iife:false`，Chrome/Firefox 共用同一 `background.js`。
修改文件：`src/anki/runtime.js`、`src/anki/content-adapter.js`、`src/anki/content-entry.js`、`tests/anki/**`、`webpack.config.js`、三个 manifest、`background.js`、`package.json`、本记录。
行为变化：新增隔离的 `LingKumaAnki` content facade 和幂等后台消息路由；仅接受 `lingkuma.anki.v1` namespace；在 a3/a4/a5 前加载；Chrome/Firefox manifest 增加 `alarms`。初始化不发网络、不写库、不修改词汇。
测试命令：`npm run test:anki`；`npm run watch` 后触碰 content entry；使用 Chromium 150 以 unpacked extension 加载 `dist`，打开 `example.com` 并从扩展隔离世界检查 facade。
实际结果：unit 3/3、integration 2/2、e2e 1/1；legacy 与 anki-content 连续构建成功；watch 同时重编译两个 compiler；扩展无加载错误，后台 state 为 `lingkuma.anki.v1` 且 listener 已注册，页面隔离世界得到同 namespace/version 1 facade。
未运行的验收：Firefox 未安装；正式 Chrome 153 已确认不接受自动 `--load-extension` 路径，因此自动化使用同机 Chromium 150，正式 Chrome 人工加载留到 T20。
回归检查：遗留 output/module 设置未全局改变；动态脚本原顺序保留；foreign message 测试证明新 listener 不抢答遗留消息；构建仍仅有原有两个体积警告。
提交：本任务提交。
下一任务：T02，冻结数据契约和确定性摘录身份。

### T02

实际基线：T01 已通过，隔离模块和测试命令可用。
修改文件：`src/anki/contracts.js`、`src/anki/identity.js`、`tests/anki/unit/contracts.test.js`、`tests/anki/unit/identity.test.js`、本记录。
行为变化：冻结 origin snapshot、消息外壳、错误码、Anki字段顺序、来源类型和输入上限；实现 NFC/空白规范化、UTF-16位置核验、固定tuple、SHA-256及 `lk1_` identity。
测试命令：`npm run test:anki:unit`；`npm run test:anki`。
实际结果：unit 26/26（含14组外部固定向量）通过，integration 2/2、e2e 1/1通过；相同规范化语境命中相同ID，不同位置/大小写/selection source产生不同ID。
未运行的验收：无；本任务为纯函数边界。
回归检查：构建成功且仍仅有原有体积警告；无DOM、网络、存储或Anki副作用。
提交：本任务提交。
下一任务：T03，实现事务化本地记录和工作队列。

## 最终真实环境验收

Anki版本 / Connect协议与能力：
目标专用测试牌组/类型：
Chrome/Edge：
Firefox：
音频提供方与真实播放：
离线与worker中断恢复：
Anki外部修改/删除：
备份恢复：
仍有的限制：
