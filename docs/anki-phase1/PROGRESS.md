# 执行记录

本文件记录实际实施与验证证据；未运行的真实环境验收不得写成通过。

状态仅使用 TODO / DOING / PASS / BLOCKED。PASS 必须附真实证据。

| 任务 | 状态 | 提交 | 测试与证据 | 限制/未运行 |
|---|---|---|---|---|
| T00 | PASS | 本任务提交 | `npm ci`; `npm run build`; `node scripts/probe-ankiconnect.mjs`; 入口/AI/TTS/浏览器审计见 BASELINE.md、CAPABILITIES.md | AnkiConnect不可达；Firefox未安装；真实音频导出未运行 |
| T01 | TODO | — | — | — |
| T02 | TODO | — | — | — |
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
