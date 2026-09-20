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
| T06 | PASS | 本任务提交 | `npm run test:anki:integration`：立即持久化、重复/新语境、异常状态、编辑/再生成/排除/恢复13/13通过 | 暂未接网页UI，按任务留T13/T14 |
| T07 | PASS | 本任务提交 | `npm run test:anki`：结构化释义、注入边界、错误分类和Abort共53/53 unit通过 | 未调用真实AI，留T20 |
| T08 | PASS | 本任务提交 | `npm run test:anki`：single-flight、乱序、重启、generation、编辑、有限重试及恢复共20/20 integration通过 | 调度/alarms并发预算留T11 |
| T09 | PASS | 本任务提交 | `npm run test:anki`：创建、读回、未知结果、重启、重复错误、租约及冲突共30/30 integration通过 | 真实Anki写入留T20 |
| T10 | PASS | 本任务提交 | `npm run test:anki`：原地更新、三方差异、未确认恢复、并发编辑及显式重建共38/38 integration通过 | 真实Anki更新与卡片复习数据观测留T20 |
| T11 | PASS | 本任务提交 | `npm run test:anki`：alarm、过期lease、AI并发、百条离线队列、全局退避及配置修复共43/43 integration通过 | 浏览器真实休眠/唤醒链留T20 |
| T12 | PASS | 本任务提交 | `npm run test:anki`：设置/凭证/绑定/profile/model/deck/可信路由共46/46 integration通过；Chromium真实连接AnkiConnect 6 | 未创建真实模型，写入验收留T20 |
| T13 | PASS | 本任务提交 | `npm run test:anki`：unit 60/60、integration 47/47、e2e 1/1；Chromium主动点击持久化且悬浮/发音/关闭不新增 | 隔离profile未配置Anki，真实最终写入留T20 |
| T14 | PASS | 本任务提交 | `npm run test:anki`：unit 64/64、integration 47/47、e2e 1/1；Chromium最终短语一次保存，网页/EPUB/PDF/字幕/iframe真实选区均持久化 | 外部阅读器与真实Anki自动写入合并验收留T20 |
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

### T06

实际基线：G0全部通过；repository具备原子capture/job，renderer和字段契约已冻结。
修改文件：`src/anki/capture-service.js`、`src/anki/repository.js`、`tests/anki/integration/capture-service.test.js`、本记录。
行为变化：新增lookup应用服务，先完成事务再返回安全DTO；重复身份复用原记录/任务，新语境直接新建；支持显式编辑、再生成、停止管理和恢复；未配置destination仍正常落盘。
测试命令：`npm run test:anki:integration`。
实际结果：integration 13/13通过；首次响应可从数据库读回；重复查询保留captureId/CapturedAt且不增job；新句子自动生成新记录；conflict、remote_missing、excluded均重开原记录；旧revision拒绝；DTO不泄露noteId、pendingWrite或远端字段正文。
未运行的验收：本任务按范围未修改网页UI，真实主动查词留T13/T14。
回归检查：构建成功且仅有原有体积警告；exclude原子取消本地任务但不删除capture/Anki，resume按当前状态恢复单一任务；服务不读取DOM或修改Known。
提交：本任务提交。
下一任务：T07，提取无DOM依赖的语境解释适配器。

### T07

实际基线：T00确认AI传输集中在后台 `handleAIRequest`，遗留a3自动路径带DOM和词汇副作用。
修改文件：`src/anki/provider-adapter.js`、`background.js`、`tests/anki/unit/provider-adapter.test.js`、本记录。
行为变化：新增无DOM的 `explainInContext`，复用既有后台provider配置/鉴权/请求；使用专用system协议与JSON材料，严格只接受meaning/句译/reading/usage；为既有transport增加可选AbortSignal，不改旧调用语义。
测试命令：`npm run test:anki`。
实际结果：unit 53/53、integration 13/13、e2e 1/1通过；有效meaning和缺省可选字段通过；坏JSON、额外deck/action字段、占位符拒绝；未配置/auth/429/中断分类正确；提示注入只作为JSON材料且请求不含URL、Cookie、词库或key。
未运行的验收：未向用户配置的真实AI提供方发请求，真实provider留T20。
回归检查：遗留 `makeAIRequest` message、用户自定义prompt和provider选择逻辑未改；构建成功且仅有原有体积警告；没有加载a3到worker或新增provider配置。
提交：本任务提交。
下一任务：T08，实现持久化释义任务及过期结果防护。

### T08

实际基线：capture与enrich job已原子落盘，provider已提供严格结构化结果；尚无持久任务执行协调层。
修改文件：`src/anki/enrichment.js`、`src/anki/repository.js`、`tests/anki/integration/enrichment.test.js`、本记录。
行为变化：enrichment按持久化capture/generation取原始语境并single-flight调用provider；有效meaning在一次事务内写回内容、递增revision并投递push；临时失败最多三次带退避，永久失败保留原句且不投递空卡；编辑和重新生成原子替换旧enrich/push任务，迟到结果因lease/generation失效。
测试命令：`npm run test:anki`。
实际结果：unit 53/53、integration 20/20、e2e 1/1通过；同摘录十次查询仅一次provider；A/B逆序各自写回；无UI和关闭重开后任务继续；人工编辑及连续generation拒绝迟到结果；两次失败后恢复，三次无效后停止且显式再生成可恢复；订阅DTO与持久内容同源。
未运行的验收：真实AI中断和浏览器worker kill留T20；alarms、并发预算与跨worker drain接线按依赖留T11。
回归检查：构建成功且仅有原有体积警告；原始context不被provider结果替换；无有效meaning时没有push任务；optional字段为空不阻断有效meaning。
提交：本任务提交。
下一任务：T09，实现幂等创建和未知结果恢复。

### T09

实际基线：有效释义已原子投递push，AnkiConnect客户端、固定模型和pendingWrite仓储接口已存在；尚无创建协调器。
修改文件：`src/anki/sync-service.js`、`src/anki/repository.js`、`tests/anki/support/fake-anki.js`、`tests/anki/integration/sync-create.test.js`、本记录。
行为变化：push创建分支写前核对profile/deck/model并按CaptureId查询、notesInfo精确复核；先持久化带当前lease的pendingWrite，再以CaptureId首字段和allowDuplicate=false调用addNote；成功后再次查询核实才确认关联。超时、重复错误、worker中断及本地确认失败均先协调远端结果，不盲目再次创建；曾关联缺失、多匹配、身份错配分别进入remote_missing/conflict。
测试命令：`npm run test:anki`。
实际结果：unit 53/53、integration 30/30、e2e 1/1通过；正常创建/读回、add成功丢响应、pendingWrite后重启、确认落盘失败恢复、查找与duplicate竞态、过期lease、同词异句、多匹配、远端删除、身份/profile错误均通过；所有场景无guiAddCards。
未运行的验收：本机AnkiConnect仍不可达，真实add/readback留T20；已关联内容更新及三方差异按依赖留T10。
回归检查：构建成功且仅有原有体积警告；无meaning没有push；不同语境只按CaptureId区分；addNote每次协调尝试最多一次且读取可自动重试、写入不自动重试。
提交：本任务提交。
下一任务：T10，实现原地更新、三方差异和待确认写恢复。

### T10

实际基线：T09已可靠创建并保存baseFields/pendingWrite，但远端存在时仅能确认完全相等内容，尚无原地更新或差异处理。
修改文件：`src/anki/sync-service.js`、`src/anki/repository.js`、`src/anki/indexeddb-store.js`、`src/anki/reconciliation-store.js`、`tests/anki/support/fake-anki.js`、`tests/anki/integration/sync-update.test.js`、本记录。
行为变化：更新按base/本地dirty渲染补丁/remote三方决策，仅向updateNoteFields发送变化字段，写前持久化完整pendingWrite并在写后精确读回；恢复优先识别intended或previousBase，响应丢失不误报冲突。确认事务只清除本次提交且当前值仍相同的dirty字段，写入期间的新revision保留后续job。远端差异保留原始字段并暂停，采用远端、采用本地、字段选择均在重新读取远端后执行；采用远端富文本后仅改UserNote不会重写其他字段。删除和错误noteId提示不触发写入，只有显式recreate再次创建。
测试命令：`npm run test:anki`。
实际结果：unit 53/53、integration 38/38、e2e 1/1通过；原noteId字段更新、卡片review状态与标签不变、远端/本地/字段选择、远端二次变化、富文本基线、update响应丢失、写入未生效恢复、发送期间并发编辑、远端删除、noteId误指向及显式重建均通过。
未运行的验收：本机AnkiConnect仍不可达，真实updateNoteFields后cardId/due/interval/reps观测留T20；当前FakeAnki按真实API边界证明只改note字段。
回归检查：构建成功且仅有原有体积警告；add创建恢复、repository租约和原有53项unit均通过；无删除重建更新、无review接口、无标签清空、无远端默认覆盖。
提交：本任务提交。
下一任务：T11，实现持久后台调度、全局退避、alarm和worker恢复。

### T11

实际基线：enrich/push均已有持久job、有限lease和协调器，但没有统一批处理预算、alarm唤醒或跨job的Anki连接退避。
修改文件：`src/anki/scheduler.js`、`src/anki/queue-store.js`、`src/anki/repository.js`、`tests/anki/integration/scheduler.test.js`、本记录。
行为变化：新增单实例批处理执行器，AI并发硬限制为2、Anki写严格串行，并同时限制每批job数和执行时间；worker启动、alarm、查询回调、设置修复和管理页入口均有显式drain钩子。队列最早执行时间与lease到期从IndexedDB计算，缺失alarm在启动时重建。Anki连接失败使用持久化1/2/5/15分钟全局退避，一条失败即停止本批，避免逐词连接风暴；共享配置错误全局暂停，修复后重排blocked记录。AI仍沿用T08有界重试，不增加永久定时器或keepalive。
测试命令：`npm run test:anki`。
实际结果：unit 53/53、integration 43/43、e2e 1/1通过；alarm callback适配、丢失alarm重建、worker重启后过期lease回收、AI最大并发2、Anki最大并发1、100条离线队列仅一次连接、退避跨执行器持久、恢复后20条分批自动排空、鉴权阻断及设置修复恢复均通过。
未运行的验收：浏览器真实休眠/系统睡眠后的alarm触发与真实Anki恢复链留T20；调度器与设置/管理消息的生产装配按依赖在T12完成。
回归检查：构建成功且仅有原有体积警告；scheduler未进入content bundle，仍为3.2 KiB；已有创建、更新、enrichment和租约测试全部通过。
提交：本任务提交。
下一任务：T12，实现一次性设置、就绪检查、可信设置消息及调度器生产装配。

### T12

实际基线：T11仅提供可装配调度器；生产后台尚未创建repository/coordinator/client，设置页也没有Anki入口、就绪检查或可信管理消息。
修改文件：`src/anki/setup-service.js`、`src/anki/background-runtime.js`、`src/anki/settings-ui.js`、`src/anki/queue-store.js`、`src/anki/repository.js`、`src/anki/anki-client.js`、`src/options/options.html`、`src/options/options.js`、`background.js`、`tests/anki/unit/setup-service.test.js`、`tests/anki/unit/anki-client.test.js`、`tests/anki/integration/setup-service.test.js`、本记录。
行为变化：设置页新增一次性Anki设置、只读连接测试、牌组选择、固定模型创建/核验、学习/释义语言、音频偏好和全局自动摘录开关。key只保存在新IndexedDB meta，public DTO仅返回hasApiKey；既不进入content DTO，也不进入遗留storage/WebDAV。首次设置仅给尚无destination的记录绑定当前profile/deck/model并恢复队列，后续目标变化只影响新记录。Profile可检测时固定预期值；不可检测时必须显式确认单Profile限制。生产后台同步注册受限消息和alarm监听，再异步装配repository、AI adapter、sync service和scheduler；设置/model动作同时校验sender扩展ID与允许页面路径。修复浏览器原生fetch/timer脱离原receiver时的`Illegal invocation`。
测试命令：`node --test tests/anki/unit/anki-client.test.js tests/anki/unit/setup-service.test.js`；`node --test tests/anki/integration/setup-service.test.js`；`npm run test:anki`；Chromium 150加载最终构建并在设置页执行只读连接测试。
实际结果：unit 56/56、integration 46/46、e2e 1/1通过；key不回传、旧未配置记录绑定、目标变更不迁移旧记录、暂停不重连、缺牌组/坏字段顺序/不支持profile确认/profile mismatch、伪造sender拒绝均通过。真实设置页显示连接AnkiConnect 6成功、27个牌组及当前profile，key输入保持空白；未保存设置、未创建模型或笔记。
未运行的验收：为避免未经选择测试牌组就修改用户Anki，真实`createModel`和设置后自动制卡留T20专用测试数据；Firefox仍未安装。
回归检查：构建成功且仅有原有体积警告；content bundle仍为3.2 KiB；设置页经截图确认布局与未配置/连接成功状态，旧查词、创建、更新、调度测试全通过。
提交：本任务提交。
下一任务：T13，将主动单词查询语义入口接到capture.lookup，并显示不阻塞阅读的持久状态。

### T13

实际基线：主动单词查询只打开遗留tooltip并各自发起AI推荐，`capture.lookup`尚未接入语义入口；后台也没有按tab/frame把持久状态反向通知当前弹窗，设置中的暂停尚未约束新摘录。
修改文件：`src/service/a4_tooltip_new.js`、`src/anki/content-adapter.js`、`src/anki/background-runtime.js`、`src/anki/capture-service.js`、`src/anki/setup-service.js`、`src/anki/repository.js`、`tests/anki/unit/content-adapter.test.js`、`tests/anki/unit/runtime.test.js`、`tests/anki/integration/capture-service.test.js`、本记录。
行为变化：仅`handleA4PointerActivation`传入的主动查询意图触发摘录；悬浮、停留重绘、发音和关闭路径不触发。语义入口用真实sentence Range与word Range同步冻结原文、精确offset和页面来源，再由controller生成独立lookupSessionId。事务ACK后tooltip显示本地保存，持久任务释义替代该主动分支的两份遗留自动AI推荐，核实写入后显示已写入Anki；换词/关窗只释放UI订阅，不取消任务。后台按captureId与tab/frame跟踪当前订阅，enrich/sync通知安全DTO，失败frame自动清理；ACK后`lookupState`补偿注册前通知竞态。已配置且暂停时原查询照常、已有记录可重开，但原子禁止新记录；固定学习语言在生成身份前覆盖页面提示语言。
测试命令：`node --test tests/anki/unit/content-adapter.test.js tests/anki/unit/runtime.test.js tests/anki/integration/capture-service.test.js tests/anki/integration/enrichment.test.js tests/anki/integration/sync-create.test.js tests/anki/e2e/message-bridge.test.js`；`npm run test:anki`；Chromium 150隔离profile加载最终构建和本地真实文章页。
实际结果：targeted 31/31通过；全套unit 60/60、integration 47/47、e2e 1/1通过。跨节点offset、A/B乱序、关闭后迟到通知、去重、持久恢复、单provider调用、精确写后核实、tab/frame订阅替换和暂停策略均通过。Chromium中悬浮后capture数保持0；真实鼠标点击后新增1条，重复主动查询、播放和关闭后仍只有该身份一条；记录冻结`The iterator yields each record…`的`yields`为13..19。tooltip显示“本地已保存，待配置 Anki”和同一持久结果“记录”，遗留AI项为0，截图确认提示不阻塞正文。
未运行的验收：隔离浏览器未完成Anki设置，因此A32的真实最终制卡与verified状态留T20专用测试牌组；本地烟测页的高亮词表为空，先在隔离world补入真实Range后再用真实鼠标事件验证入口，未把该限制伪装成完整自然文章高亮验收。短语/EPUB/PDF/字幕入口按依赖留T14。
回归检查：构建成功且仅有原有体积警告；content bundle由3.2 KiB增至5.96 KiB；普通字典、词汇状态、TTS和手动深度分析路径未移除，非主动tooltip仍走原行为。
提交：本任务提交。
下一任务：T14，冻结短语最终选区并统一网页、EPUB、PDF与字幕来源适配。

### T14

实际基线：短语Create入口在清除selection和弹窗状态后才读取定位，并用`indexOf`寻找文本，无法区分同句重复词或跨节点位置，也不传T13的capture intent；单词入口把所有来源硬编码为web。
修改文件：`src/anki/reader-adapters.js`、`src/anki/content-adapter.js`、`src/service/a4_tooltip_new.js`、`src/service/a5_custom_word_selection.js`、`tests/anki/fixtures/reader-contexts.js`、`tests/anki/unit/reader-adapters.test.js`、本记录。
行为变化：短语仅在用户点击现有Create按钮时同步克隆最终Range、矩形、语言和来源，再清除selection；`selectionchange`/拖动仅更新候选弹窗，不落盘。统一reader adapter通过Range前缀计算UTF-16精确位置，按真实句界或以目标为中心裁至8000单元，保留emoji、组合字符、重复同形词和跨节点文本；只能取得选区时保存`selection_only`并以文档与定位构造稳定fallback key，超过256码点明确不自动摘录且不截断。来源仅依据当前目标所在的现有DOM入口识别：普通网页保留完整SPA URL，EPUB保留文档ID/章节，PDF保留页码，字幕保留当前条目的时间点；blob不作为长期URL。单词入口也改走同一来源适配，iframe自然使用自身document URL。
测试命令：`node --test tests/anki/unit/reader-adapters.test.js tests/anki/unit/content-adapter.test.js tests/anki/unit/contracts.test.js`；`npm run build`；`npm run test:anki`；Chromium 150隔离profile在真实可选DOM上执行拖动、跨标签最终选择及web/EPUB/PDF/字幕/iframe的原Create手势。
实际结果：targeted 13/13通过；全套unit 64/64、integration 47/47、e2e 1/1通过。浏览器拖动三次后capture仍为0，最终`repeated phrase`只新增1条，冻结真实句`A second repeated phrase…café intact.`及9..24；emoji/NFD保持不变。EPUB、PDF、字幕分别持久化`Chapter 4`、`page 12`、`00:01:05.432`，web不受同页其他reader容器误分类。iframe记录保留自身`?chapter=7#line=2`与34..49。四类Create弹窗均真实出现并点击，截图确认最终选区弹窗不遮挡正文。
未运行的验收：浏览器场景使用受控页面复现项目现有reader DOM入口，没有声称启动了外部EPUB应用、Mozilla PDF.js或真实YouTube视频；隔离profile未配置Anki，因此A35的外部入口与真实自动写卡联合验收按计划留T20专用测试数据。Firefox仍未安装。
回归检查：最终构建成功且仅有原有体积警告；content bundle为10.7 KiB。整句分析按钮仍只走原分析功能，点击单词不会扩成短语，Create之外的选区变化不调用capture。
提交：本任务提交。
下一任务：T15，复用可导出发音渠道并以独立幂等任务附加Anki媒体。

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
