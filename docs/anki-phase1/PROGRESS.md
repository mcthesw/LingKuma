# 执行记录

本文件记录实际实施与验证证据；未运行的真实环境验收不得写成通过。

状态仅使用 TODO / DOING / PASS / BLOCKED。PASS 必须附真实证据。

| 任务 | 状态 | 提交 | 测试与证据 | 限制/未运行 |
|---|---|---|---|---|
| T00 | PASS | 本任务提交 | `npm ci`; `npm run build`; `node scripts/probe-ankiconnect.mjs`; 入口/AI/TTS/浏览器审计见 BASELINE.md、CAPABILITIES.md | AnkiConnect不可达；Firefox未安装；真实音频导出未运行 |
| T01 | PASS | 本任务提交 | `npm run test:anki`（6/6）；连续构建；watch重编译；Chromium 150加载dist并核实后台listener、content facade | Firefox未安装；正式Chrome 153自动加载受发行版命令行限制，使用同机Chromium实测 |
| T02 | PASS | 本任务提交 | `npm run test:anki`：14组固定identity vectors及offset/Unicode/message边界全部通过 | 无 |
| T03 | PASS | 本任务提交 | `npm run test:anki:integration`：并发、原子回滚、重启、租约、revision、pendingWrite、迁移8/8通过 | 无 |
| T04 | PASS | 本任务提交 | `npm run test:anki`：协议/错误/timeout/loopback/redirect/profile及写请求单次尝试全部通过 | 本机AnkiConnect仍不可达，真实返回形状留T20 |
| T05 | PASS | 本任务提交 | `npm run test:anki`：模板、兼容性、正确目标强调及恶意HTML/media/source输入全部通过 | 真实Anki卡片外观留T20 |
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

### T03

实际基线：T02 已通过，captureId 和边界输入已冻结。
修改文件：`src/anki/repository.js`、`tests/anki/integration/repository.test.js`、`package.json`、`package-lock.json`、本记录。
行为变化：新增独立 `lingkuma-anki-v1` IndexedDB，含 captures/jobs/media/meta 和显式索引；capture+首个job原子提交；支持revision编辑、generation、去重任务、有限租约、pendingWrite、确认、远端差异和分页读取。
测试命令：`npm run test:anki:integration`。
实际结果：integration 8/8通过；20个并发查询仅一个created结果、一条capture和一个enrich job；模拟QuotaExceeded时capture/job全部回滚；关闭重开后数据和过期租约可恢复；旧revision及旧owner无法覆盖新状态；坏同版本schema保持原库并明确失败。
未运行的验收：无；使用 `fake-indexeddb@6.2.4` 执行真实IndexedDB事务语义。
回归检查：双Webpack compiler构建通过且仅有原有体积警告；repository不引用DOM、网络或遗留词汇库。
提交：本任务提交。
下一任务：T04，实现唯一的 AnkiConnect 客户端。

### T04

实际基线：T02/T03 已通过；T00 的本机 AnkiConnect 探测仍不可达。
修改文件：`src/anki/anki-client.js`、`src/anki/contracts.js`、`tests/anki/unit/anki-client.test.js`、本记录。
行为变化：新增唯一 AnkiConnect client；固定version 6、手动redirect、loopback origin、可选后台key、超时和结构化错误；仅暴露窄动作封装，禁止sync/loadProfile/任意action；只有读请求可受控重试。
测试命令：`npm run test:anki:unit`；`npm run test:anki`。
实际结果：unit 38/38、integration 8/8、e2e 1/1通过；合法null/false/[]及额外响应字段保留；HTTP/JSON/远端错误/断网/timeout分类正确；add/update/media无传输层重试；远端、伪localhost、凭证URL和redirect均拒绝；profile不符停止，不支持检测时返回明确限制。
未运行的验收：本机没有可达的 AnkiConnect，真实安装版本的动作和返回形状继续保持未验证，留T20。
回归检查：构建成功且仅有原有体积警告；key只进入请求体，不进入错误详情；没有第二套fetch或任意URL代理。
提交：本任务提交。
下一任务：T05，实现专用笔记类型和安全卡片渲染。

### T05

实际基线：T02字段/身份契约与T04唯一client已通过。
修改文件：`src/anki/note-model.js`、`tests/anki/unit/note-model.test.js`、本记录。
行为变化：定义 `LingKuma Lookup v1` 的12个有序字段、一张普通卡和本地CSS；增加显式model ensure/兼容检查、牌组检查、纯字段渲染及Anki note构造。普通写入不接触模板/CSS。
测试命令：`npm run test:anki:unit`；`npm run test:anki`。
实际结果：unit 46/46、integration 8/8、e2e 1/1通过；第一字段CaptureId、单模板非cloze、正面Term+Context、背面Meaning+原正面；重复词仅正确位置强调；HTML、引号、Anki media/LaTeX指令和非HTTP URL保持惰性文本；Audio只接受完整安全文件名。
未运行的验收：尚未在真实Anki reviewer中查看最终卡片外观，留T20。
回归检查：已有兼容model只读字段并复用，不调用createModel；不兼容字段/顺序和牌组缺失明确阻断；无远程CSS/JS/资源。
提交：本任务提交。
下一任务：T06，实现主动查词的立即保存服务。

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
