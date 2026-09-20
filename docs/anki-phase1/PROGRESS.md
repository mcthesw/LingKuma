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
| T15 | PASS | 本任务提交 | `npm run test:anki`：unit 67/67、integration 52/52、e2e 1/1；Supertone真实协议适配、内容哈希媒体、文字先写、上传中断复用及旧voice结果隔离通过 | 未消耗用户Supertone额度；真实Anki媒体播放留T20专用测试数据 |
| T16 | PASS | 本任务提交 | `npm run test:anki`：unit 67/67、integration 57/57、e2e 1/1；管理搜索/分页/分组、编辑、冲突/缺失/多匹配、打开关联、停止/恢复通过；Chromium验证最终管理页 | 真实Anki上的管理全链留T20；浏览器UI使用受控后台DTO，未修改用户数据 |
| T17 | PASS | `6845a3e` | `npm run test:anki`：unit 67/67、integration 60/60、e2e 1/1；接管、巡检、重绑定及管理核对通过；Chromium验证最终核对入口 | 六小时间隔以受控时钟推进；真实Anki外部编辑/删除留T20 |
| T18 | PASS | `2b08002` | `npm run test:anki`：unit 67/67、integration 64/64、e2e 1/1；版本化备份、严格校验、安全合并及媒体恢复通过；Chromium验证最终导入导出入口 | 未写用户下载目录或真实Anki媒体；Firefox未安装 |
| T19 | PASS | 本任务提交 | `npm run test:anki`：unit 74/74、integration 64/64、e2e 1/1；安全targeted 42/42；Chromium验证最终敏感选择守卫和单监听 | 未在真实密码管理器输入凭证；Firefox未安装 |
| T20 | PASS | 本任务提交 | 全套unit 74/74、integration 67/67、e2e 1/1+真实A49 1/1；真实AnkiConnect 6专用牌组链路、500条离线队列、三类写入三断点、Firefox 156实际加载 | 未调用真实AI/发音付费渠道，未做真实Reviewer播放、人工复习后更新或系统睡眠 |
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

### T15

实际基线：设置已有`attachAudio`且schema预留media store/job/state，Anki client已有`storeMediaFile`，但没有媒体任务、字节导出适配或Audio更新流程；现有本地/Edge等播放路径不能直接作为持久媒体。
修改文件：`src/anki/audio-provider.js`、`src/anki/media-service.js`、`src/anki/media-store.js`、`src/anki/repository.js`、`src/anki/scheduler.js`、`src/anki/background-runtime.js`、`tests/anki/support/fake-anki.js`、`tests/anki/unit/audio-provider.test.js`、`tests/anki/integration/media-service.test.js`、本记录。
行为变化：仅当用户启用单词TTS并选择已配置Supertone时，后台按现有voice/model/language/format配置直接取得词语音频字节，不依赖popup播放；本地TTS、speechSynthesis、blob URL及其他不可导出渠道明确标记unavailable。响应限制5 MiB并同时核验音频MIME和MP3/WAV/OGG文件头，拒绝HTML/空内容；以SHA-256生成`lk_audio_<hash>.<ext>`并持久化字节及Anki实际文件名。调度严格先完成文字push，再串行处理media，上传后把Audio作为dirty intent交回同一push/三方差异路径。job在网络请求前持久化term/language/voice等inputKey，完成前重读配置阻止旧音频迟到；上传后的本地状态让worker中断重试复用同一文件，不新建笔记或随机文件。音频unavailable/failed只改变mediaState，不回滚已同步文字；profile/认证等共享配置错误保留任务并服从全局阻断/修复。
测试命令：`node --test tests/anki/unit/audio-provider.test.js tests/anki/integration/media-service.test.js tests/anki/integration/scheduler.test.js`；`npm run build`；`npm run test:anki`。
实际结果：targeted 13/13通过；全套unit 67/67、integration 52/52、e2e 1/1通过。验证真实Supertone请求形状与复用配置、不可导出渠道降级、HTTPS/凭证边界、MIME/头/大小拒绝、确定性哈希文件名、文字先成功、同一note追加完整sound引用、上传后worker中断不重复上传、voice切换旧结果不附加；最终构建成功且仅有原有体积警告，content bundle仍为10.7 KiB。
未运行的验收：为不未经授权消耗用户Supertone额度或向用户Anki写入媒体，本任务未调用真实账号；真实Supertone返回、AnkiConnect `storeMediaFile`返回形状及Reviewer播放按计划在T20专用牌组/记录中验收，不把mock网络边界写成真实播放通过。Firefox仍未安装。
回归检查：文本add/update/冲突仍只经SyncService；音频失败场景link保持synced且addNote仍为一次；不截视频、不生成整句、不录系统音频、不删除远端孤儿媒体；生产background已装配同一持久调度器。
提交：本任务提交。
下一任务：T16，实现摘录管理、编辑、停止/恢复及异常处理。

### T16

实际基线：后台已有单条编辑、再生成、排除/恢复及冲突/缺失协调方法，但没有可信管理路由、分页搜索、管理DTO或页面；异常只能留在存储状态中，用户无法查看和处理。
修改文件：`src/anki/capture-status.js`、`src/anki/management-store.js`、`src/anki/management-service.js`、`src/anki/manager.html`、`src/anki/manager.css`、`src/anki/manager.js`、`src/anki/background-runtime.js`、`src/anki/capture-service.js`、`src/anki/repository.js`、`src/anki/settings-ui.js`、`src/options/options.html`、`webpack.config.js`、`tests/anki/support/fake-anki.js`、`tests/anki/integration/management-service.test.js`、本记录。
行为变化：新增独立轻量管理页及设置入口，支持跨全部本地记录的关键词搜索、状态筛选、稳定游标分页和按词归组；展示冻结原句、释义、来源、更新时间、最后核实时间和独立音频状态。可信管理命令使用expectedRevision编辑释义/读音/翻译/用法/个人笔记并经既有push原地更新；停止管理后的记录拒绝编辑。冲突页以纯文本并排显示本地/Anki字段，可保留Anki、使用本地或选择本地字段，处理时仍由SyncService重新读取远端。缺失记录只在“显式重建”后恢复创建；多CaptureId匹配显示具体错误，用户修复Anki后可重试。打开关联笔记前重新核对profile、CaptureId、model和唯一性。停止管理删除本地任务但保留身份与远端笔记，再次相同查询只返回excluded；只有显式恢复才重新管理。
测试命令：`node --test tests/anki/integration/management-service.test.js`；`npm run build`；`npm run test:anki`；Chromium加载最终`dist/src/anki/manager.html`并用受控安全DTO执行搜索和编辑交互。
实际结果：targeted 5/5通过；全套unit 67/67、integration 57/57、e2e 1/1通过。35条记录两页无重复，词语分组/全文搜索正确；编辑只更新原capture且STALE_REVISION拒绝旧表单；正常编辑原note且addNote不增加；冲突双方展示、远端二次变化拒绝、多匹配零写入；缺失不隐式重建，显式动作后只创建一次；排除不删Anki、不复活，恢复显式。Chromium最终页面展示同词两语境、冲突对照和missing操作，搜索缩至1条，编辑个人笔记后重开值保持；页面未产生capture。
未运行的验收：浏览器验收使用最终构建UI和受控后台DTO，后端命令由真实IndexedDB/FakeAnki集成测试覆盖；未在用户真实Anki上打开、修改或重建笔记，完整真实管理链留T20专用测试记录。Firefox仍未安装。
回归检查：管理路由继续要求extension id和`manager.html`/options可信路径；内容脚本没有列表、任意noteId或Anki action权限。管理页面所有网页/AI/远端值只经`textContent`显示；普通查词入口未改，打开历史/搜索/编辑不调用capture lookup。
提交：本任务提交。
下一任务：T17，实现关联重绑定与本机外部变更巡检。

### T17

实际基线：稳定CaptureId查找已在每次写入前执行，但无本地基线且远端内容不同会被误判为冲突，无法安全接管由Anki同步回来的既有笔记；关联记录只在下一次写入或手动打开时被核对，没有持久化低频巡检任务，也不能区分生成内容与首次绑定前的人工编辑。
修改文件：`src/anki/association-store.js`、`src/anki/reconciliation-service.js`、`src/anki/reconciliation-store.js`、`src/anki/sync-service.js`、`src/anki/repository.js`、`src/anki/scheduler.js`、`src/anki/management-service.js`、`src/anki/manager.js`、`src/anki/background-runtime.js`、`tests/anki/integration/reconciliation.test.js`、`tests/anki/integration/management-service.test.js`、本记录。
行为变化：记录人工修改字段来源；首次按CaptureId找到已有远端且本地未人工编辑时，原子接管远端noteId和字段基线、清空生成脏字段，不add、不update；首次绑定前已人工编辑则保留双方并进入冲突。新增每条已关联记录独立的持久化`inspect`任务，默认六小时低频核对，启动/每批结束补种，沿用Anki全局退避并与push/media串行；每次只按一个CaptureId调用findNotes/notesInfo，不扫描牌组或collection。巡检识别外部编辑、删除、同ID多笔记，并在字段未变时安全更新变化后的noteId。管理编辑和打开前立即核对，页面增加“核对 Anki”；冲突、缺失、阻止状态下的本地编辑保留脏字段但不排入自动写入。界面只展示本机Anki核实时间和状态，不推断AnkiWeb或手机同步。
测试命令：`node --test tests/anki/integration/reconciliation.test.js tests/anki/integration/management-service.test.js`；`npm run test:anki`；`browser-use`加载最终`dist/src/anki/manager.html`，注入受控管理DTO并点击“核对 Anki”。
实际结果：targeted 8/8通过；全套unit 67/67、integration 60/60、e2e 1/1通过，构建仅有既有包体积警告。A41证明远端不同释义被接管且add/update均为0，首次绑定前人工编辑进入冲突；A42证明定时任务发现外部编辑、删除、noteId变化和同ID多笔记，noteId变化且字段相同自动重绑定；管理编辑/打开改为先即时核对。A43动作日志中`sync`、`loadProfile`和排程修改API均为0，巡检只查询四个目标CaptureId。最终页面显示单一“核对 Anki”操作，点击后状态为“已完成”且最后核实时间更新。
未运行的验收：六小时间隔以受控时钟推进，未等待真实六小时；未触碰用户真实Anki或AnkiWeb，真实外部编辑/删除链留T20专用测试记录。浏览器使用受控后台DTO，IndexedDB与Anki调用由集成测试覆盖；Firefox仍未安装。
回归检查：检查任务持久化且worker重启后可补种；push、media、inspect仍共享单一串行Anki通道和全局退避。远端冲突/缺失会删除待写push，必须经既有显式冲突解决或重建恢复；停止管理删除全部任务。没有调用sync/loadProfile、没有修改Known、没有实现远程队列或跨设备恰好一次承诺。
提交：本任务提交。
下一任务：T18，实现安全备份与恢复。

### T18

实际基线：本地IndexedDB已持久化摘录、任务、媒体和设置，但没有版本化导出、导入校验或管理页入口；直接复制数据库会同时带走凭证、活动lease和可重放pendingWrite，也无法安全合并已有较新内容。
修改文件：`src/anki/backup-service.js`、`src/anki/backup-store.js`、`src/anki/media-service.js`、`src/anki/association-store.js`、`src/anki/reconciliation-service.js`、`src/anki/background-runtime.js`、`src/anki/manager.html`、`src/anki/manager.css`、`src/anki/manager.js`、`tests/anki/integration/backup.test.js`、本记录。
行为变化：新增本地专用、版本化JSON备份，导出冻结原始证据、当前材料、人工字段来源和最小关联基线；不读取meta/jobs，不包含key、endpoint、活动lease、requestId、noteIdHint、lastVerifiedAt或pendingWrite。可选音频仅导出被摘录引用、≤5 MiB且受支持的内容哈希文件，不信任旧Anki媒体名。导入同时限制16 MiB/50000条，严格校验结构、字段长度、稳定身份重算、CaptureId/基线一致性、媒体头和SHA-256；全部校验完成后再在单个captures/jobs/media事务合并。已有capture永不覆盖：材料相同计重复，不同计冲突；新关联清除noteId和核实时间并先排inspect，旧本地差异核实后进入双方可见冲突，不自动写Anki。远端已删除则标missing且不复活。可选媒体在关联核实后从已校验本地字节重新上传，再走既有安全push协调。结果返回恢复、重复、冲突、拒绝和媒体恢复计数。
测试命令：`node --test tests/anki/integration/backup.test.js tests/anki/integration/reconciliation.test.js`；`npm run test:anki`；`browser-use`加载最终`dist/src/anki/manager.html`，使用受控后台执行导出和文件导入交互。
实际结果：targeted 7/7通过，其中T18 A44-A46为4/4；全套unit 67/67、integration 64/64、e2e 1/1通过，构建仅有既有包体积警告。A44导出文本无secret、lease、pendingWrite或opId，恢复材料可读且旧noteId/核实时间为空，关联先核对，本地未确认差异转冲突且零update；可选WAV经哈希恢复并在核实后上传一次，未调用提供方且未信任旧文件名。A45旧备份对较新本地内容返回冲突且内容不变，Anki已删除时只标missing、addNote为0。A46坏版本、17 MiB输入和篡改CaptureId均在事务前拒绝，目标库保持0条。最终页面显示简洁备份区；导出反馈1条且生成日期文件名，导入反馈恢复2/重复1/冲突1/拒绝0。
未运行的验收：浏览器下载点击被拦截并核对生成文件名，未向用户下载目录写测试文件；文件内容和恢复由真实Blob/File页面路径及真实IndexedDB集成测试分别覆盖。未在用户真实Anki上传恢复媒体，使用FakeAnki验证上传和零误建；Firefox仍未安装。
回归检查：导入不删库、不重建库、不写meta设置，不读取或上传云端；任何记录/媒体校验失败均在写事务前终止。恢复任务均为重新生成的无lease任务，绝不恢复旧pendingWrite；同ID已有记录不会因备份时间戳或旧synced状态被覆盖。关联、媒体和内容写入继续经过既有巡检、差异保护及串行调度。
提交：本任务提交。
下一任务：T19，收紧安全边界并完成隐私回归。

### T19

实际基线：AnkiConnect客户端已有精确loopback端点、手动重定向和action白名单，渲染器与模型适配也已有输入边界；剩余缺口是同命名空间消息仍接受额外字段/数组payload，可信管理与content能力缺少一体化越权回归，重复初始化会重复注册划词全局监听，密码框/表单/contenteditable选择没有统一拒绝，部分tooltip直接移除路径未释放Anki状态订阅。
修改文件：`src/anki/runtime.js`、`src/anki/contracts.js`、`src/anki/content-adapter.js`、`src/service/a4_tooltip_new.js`、`src/service/a5_custom_word_selection.js`、`tests/anki/unit/runtime.test.js`、`tests/anki/unit/content-adapter.test.js`、`tests/anki/unit/security-boundary.test.js`、`tests/anki/unit/selection-lifecycle.test.js`、本记录。
行为变化：同命名空间消息现在只接受精确`namespace/requestId/type/payload`四字段普通对象，requestId/type均限制1–128字符，payload拒绝null/数组；外部消息仍无副作用忽略。管理能力继续只允许本扩展options/manager路径，content能力只允许本扩展tab/frame；content facade仅暴露lookup/get/lookupState，没有列表、备份、设置、任意action或URL接口。统一识别input/textarea/select及可编辑区域，划词的mouseup/touch/selectionchange路径均不读取或弹出敏感选择；黑名单检查不能再被二次初始化绕过。划词初始化使用单例哨兵，pagehide移除六类捕获监听及timer。通知订阅逐个隔离异常；tooltip正常关闭、错误清理、删词和快捷键替换路径统一释放lookup controller，迟到通知不再更新已移除UI。新增正式`FORBIDDEN`错误码。
测试命令：`node --test tests/anki/unit/runtime.test.js tests/anki/unit/content-adapter.test.js tests/anki/unit/security-boundary.test.js tests/anki/unit/selection-lifecycle.test.js tests/anki/unit/anki-client.test.js tests/anki/unit/note-model.test.js tests/anki/unit/provider-adapter.test.js`；`npm run test:anki`；`browser-use`加载最终content bundle与真实密码输入fixture，检查构建后的敏感选择守卫、消息数和runtime监听数。
实际结果：targeted 42/42通过；全套unit 74/74、integration 64/64、e2e 1/1通过，构建仅有既有包体积警告。A09继续证明localhost.evil、远端/带凭证/带路径端点及重定向拒绝，写请求未知结果不盲重试；A13证明HTML、媒体指令、LaTeX、恶意来源和长文本只作惰性文本；A17证明模型材料有界且注入语句/额外action不能改变协议。A47证明网页/外部扩展/content sender无法调用管理能力，管理页也不能调用content capture；公开settings只有hasApiKey，公开capture无noteId/base/pendingWrite，备份泄密回归由T18继续覆盖。A48证明重复facade/划词初始化各只保留一份监听，pagehide清理后为0，黑名单二次初始化仍为0，controller重复dispose只执行一次。最终构建在浏览器中对密码值`do-not-capture`返回blocked=true，网络消息0，runtime监听1。
未运行的验收：浏览器fixture验证最终构建的守卫与监听面，没有在真实网站密码管理器/复杂shadow-DOM编辑器中输入真实凭证；这些路径由DOM节点/Shadow host单元回归覆盖。Firefox仍未安装，真实Chrome/Firefox重复注入与frame导航留T20/T21记录。
回归检查：未增加通用fetch代理、外部消息入口、任意Anki action或云端同步。Anki key只在后台IndexedDB私有settings中读取；公开DTO、日志路径、备份和旧WebDAV均没有读取该meta key。内容查询仍只发送冻结且有界的当前语境；失败通知不聚焦页面且单个渲染异常不阻断持久化或其他订阅者。
提交：本任务提交。
下一任务：T20，完成故障注入与真实链路验收。

### T20

实际基线：A00～A48已有按任务分布的自动化、Chromium页面和少量只读Anki证据，但缺少可重复执行的真实Anki写入链；媒体更新缺失请求前与丢响应断点，update缺失远端成功后本地确认失败断点，离线队列仅100条。通用构建产物实际不能被Firefox 156安装：Firefox拒绝`background.service_worker`，且popup/options被Webpack重复注入脚本后出现顶层变量重声明。
修改文件：`tests/anki/e2e/real-ankiconnect.test.js`、`tests/anki/integration/sync-update.test.js`、`tests/anki/integration/media-service.test.js`、`tests/anki/integration/scheduler.test.js`、`manifest-firefox.json`、`manifest-firefox-local.json`、`webpack.config.js`、`webpack.firefox.config.js`、`package.json`、本记录。
行为变化：新增显式`npm run build:firefox`，输出独立`dist-firefox`，使用Firefox后台scripts清单且不声明Firefox不支持的offscreen/sidePanel；Chromium仍输出`dist`及service worker。popup/options不再被构建器重复注入自身bundle。新增默认跳过、仅在`ANKI_REAL_E2E=1`运行的破坏面受限真实验收：创建/复用专用牌组和生产笔记类型，仅删除本轮CaptureId对应笔记，不清空牌组/model/collection。故障矩阵补齐update确认失败、媒体过期lease、媒体响应丢失；离线队列提高到500条。
测试命令：`node --test tests/anki/integration/sync-create.test.js tests/anki/integration/sync-update.test.js tests/anki/integration/media-service.test.js`；`node --test tests/anki/integration/scheduler.test.js`；`ANKI_REAL_E2E=1 ANKI_TEST_DECK=\"LingKuma Phase1 Acceptance\" node --test tests/anki/e2e/real-ankiconnect.test.js`；`npm run test:anki`；`npm run build:firefox`；`npx web-ext lint --source-dir dist-firefox --self-hosted`；`web-ext run`在Firefox 156加载`dist-firefox`。
实际结果：写入故障targeted 26/26、调度5/5、全套unit 74/74、integration 67/67、常规e2e 1/1通过；真实A49 1/1通过。AnkiConnect协议6、profile“账户1”上创建专用`LingKuma Phase1 Acceptance`牌组和`LingKuma Lookup v1`类型；一次lookup只调用受控provider一次、addNote一次，自动读回CaptureId。网络断开时任务保留dirty且不假称新内容已确认，恢复后原noteId更新；外部Meaning与本地UserNote并发差异进入冲突，逐字段选择后保留双方选择。更新前后cardId及queue/due/interval/reps/lapses/left/factor完全一致；备份含该记录且无key/pendingWrite。finally只按本轮CaptureId删除笔记，随后专用牌组findNotes为0。生产动作日志中guiAddCards/sync/loadProfile/changeDeck/setDueDate均为0，常规逐词保存/确认点击为0。500条离线任务只探测一次，恢复后25批串行排空。Firefox 156通过`web-ext`实际安装临时扩展，修复后的当前会话没有LingKuma脚本错误；lint为0 error/0 notice/99 warning，warning来自遗留动态innerHTML和Firefox不识别的tts权限等既有非Anki面。
A00～A13证据：T00～T05的基线、固定向量、事务/API/模板自动化及T19安全回归；本次真实协议再次确认version=6、`result/error`形状、27个牌组、19个模型、active profile和所有生产所需action。A14～A20证据：T06～T08的重复语境、single-flight、乱序/关闭UI/人工编辑、有限恢复测试。A21～A30证据：T09～T12加本次add/update/storeMedia三类网络写入的请求前、远端成功/响应丢失、本地确认前中断，真实add/update读回与500条恢复。A31～A40证据：T13～T16的Chromium真实鼠标入口、短语/reader DOM、媒体故障及管理UI。A41～A48证据：T17～T19的关联、巡检、备份、安全和生命周期回归，加Firefox实际安装。A49由本次真实专用Anki链路覆盖设置→查询→本地→Anki→编辑→离线→恢复→外部差异→备份。
未运行的验收：没有使用用户付费AI/Supertone配置，真实provider返回与真实Anki发音上传/Reviewer播放未运行；自动化使用同契约受控provider，音频边界和恢复使用FakeAnki。没有在外部EPUB应用、PDF.js和真实视频网站做联合写卡，只验证过受控等价DOM入口。没有让真实卡片完成一次人工复习后再更新，真实链只证明新卡所有可见调度字段更新前后不变。没有等待系统睡眠或真实杀浏览器worker，使用持久IndexedDB重开、过期lease和alarm丢失故障。Anki Desktop应用版本未能从Connect读取，记录的是Connect协议6；不把它写成桌面版本。Firefox lint的99项遗留非Anki warning没有在本任务做无关清理。
回归检查：真实验收未使用用户现有牌组/类型或删除非本轮笔记；专用牌组最终为空。生产客户端仍拒绝createDeck/deleteNotes/cardsInfo等测试专用action，测试清理通过隔离harness直接调用，不扩大扩展权限。Chromium/Firefox输出目录和后台清单分离；常规build仍生成Chromium service worker。现有provider、Known、AnkiWeb同步和复习排程均未修改。
提交：本任务提交。
下一任务：T21，交付文档、可复验命令和最终回归门。

## 最终真实环境验收

Anki版本 / Connect协议与能力：Anki Desktop正在profile“账户1”运行；Connect协议6，真实返回统一`{result,error}`，生产所需version/deck/model/profile/find/notesInfo/add/update/storeMedia/guiBrowse action均由`apiReflect`确认。Connect不提供桌面应用版本，未猜测。
目标专用测试牌组/类型：`LingKuma Phase1 Acceptance` / `LingKuma Lookup v1`；真实A49结束后牌组笔记数0，类型和空牌组保留供重复验收。
Chrome/Edge：Chromium 150实际加载扩展/最终bundle并覆盖主动点击、短语、reader适配、管理、备份和安全页面；本机Chrome 153与Edge 154可用，但发行版Chrome拒绝自动`--load-extension`，没有把Chromium结果记成品牌Chrome人工测试。
Firefox：官方Firefox 156.0；`npm run build:firefox`产物经`web-ext`临时安装成功，Getting Started页面渲染，修复重复bundle注入后当前会话无LingKuma脚本错误。`web-ext lint`为0 error，遗留非Anki warning 99。
音频提供方与真实播放：未运行。没有消耗用户Supertone额度或向真实Anki上传测试音频；协议、校验、哈希上传、中断恢复和Audio字段更新由T15集成测试覆盖。
离线与worker中断恢复：真实Anki链注入网络不可达后恢复并原noteId更新；add/update/media的请求前、远端成功丢响应和本地确认前中断全部自动化；500条队列一次探测后25批排空。真实系统睡眠/浏览器进程强杀未运行。
Anki外部修改/删除：真实外部Meaning修改与本地UserNote差异被巡检识别为conflict并逐字段安全合并；真实清理仅删除本轮CaptureId笔记。外部删除/误指noteId使用FakeAnki覆盖，未在真实桌面执行删除异常链。
备份恢复：真实A49导出当前记录并验证无key/pendingWrite；真实IndexedDB导入、旧备份冲突、删除不复活、媒体恢复及坏输入原子拒绝由T18覆盖。未向用户下载目录写文件。
仍有的限制：真实付费AI、真实发音与Reviewer播放、外部EPUB/PDF/视频网站联合写卡、已人工复习卡更新、真实系统睡眠/worker强杀、品牌Chrome/Edge人工加载均明确未运行；不影响一期实现代码，但发布前人工检查表仍需在用户愿意提供相应环境/额度时执行。AnkiWeb/移动端同步不在一期职责内。
