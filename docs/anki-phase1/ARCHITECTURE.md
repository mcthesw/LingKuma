# 架构与不变量

## 1. 采用什么、不采用什么

沿用项目的原生 JavaScript + Webpack。新增代码使用有明确依赖的独立模块和 JSDoc 类型；可以只对新增目录启用 checkJs。不要迁移整个项目到 TypeScript，不引入 UI 框架、依赖注入容器、事件溯源框架或通用同步引擎。

逻辑上只有一条数据通路：

```text
现有主动查词入口
  → content-adapter：同步冻结原文与目标位置
  → runtime 消息
  → capture-service：去重 + 持久化
  → enrichment：获取当前语境释义
  → sync-service：协调创建/更新/核实
  → anki-client：本机 HTTP

popup/manager ← 只读 DTO/状态通知 ← repository
media-service → 更新同一摘录的 Audio 意图 → 同一 sync-service
```

弹窗不是任务执行器。Anki client 不知道 DOM/词汇高亮。repository 不发网络请求。AI 不决定记录身份。媒体模块不绕过 sync-service 直接更新 Anki 笔记。

## 2. 建议目录（文件可以小幅合并，不要增设架构层）

```text
src/anki/
  contracts.js             数据、错误码、消息校验；纯函数
  identity.js              规范化、目标位置、captureId；纯函数
  repository.js            独立 IndexedDB、事务、任务租约
  capture-service.js       create-or-get、编辑、排除、恢复管理
  provider-adapter.js      现有 AI 配置/请求方式的窄适配
  enrichment.js            结构化释义任务、修订检查
  anki-client.js           唯一的 AnkiConnect HTTP 实现
  note-model.js            字段、模板、转义、配置验证；渲染是纯函数
  sync-service.js          查找、创建、更新、未确认写入恢复、差异
  media-service.js         可导出 TTS 适配、媒体持久化与上传
  runtime.js              消息路由、启动、闹钟、任务调度
  content-adapter.js       唯一公开查词桥接，popup 状态展示
  reader-adapters.js       网页/EPUB/PDF/字幕输入差异
  manager.html/js/css      设置 + 摘录管理（也可拆设置文件）
tests/anki/
  fixtures/  fakes/  *.test.*
```

纯核心接收 `repo / ankiClient / provider / clock / idFactory` 等具体依赖作为参数即可；不实现框架式注册表。新增小型 IndexedDB 测试库属于合理开发依赖。

## 3. 遗留代码集成限制

已查看的 Webpack 配置将 content/service 文件分别作为经典脚本入口输出，并使用 `iife:false`。a4/a3 内也存在窗口级状态及跨文件共享。读取范围见 `SOURCES.md` 的 R3。**不能假设给这些文件增加 import 或切换 output.module 不改变其作用域。**

T01 必须使新增 bundle 自身隔离，并验证其加载不会遮蔽/覆盖遗留运行时符号。可以采用独立隔离入口和必要的轻量加载器；保留遗留脚本的可见性和加载顺序。

content 暴露至多一个隔离世界中的命名空间 `globalThis.LingKumaAnki`，供已有查询入口调用；不挂到网页 MAIN world，不暴露任意 Anki action 或任意 URL 转发。

消息/alarms监听器要在后台加载时同步注册；handler内部可等待初始化Promise。新消息监听器只处理自己的namespace，不得抢答遗留消息；必要时为遗留通用handler增加最小的namespace排除。不要把所有onMessage监听器改成无条件async返回。

Chrome 后台 worker 与 Firefox 后台 scripts 都必须加载新运行时且仅初始化一次。不要把 Chrome 的 importScripts 直接假定为 Firefox 窗口里的函数；也不要为了统一二者重构整个 background。

若使用额外 Webpack 配置/编译器，必须处理原 CleanWebpackPlugin 与新产物的顺序关系；两次 build 和 watch 重编译都不能删除新 bundle。具体入口选择在 T00/T01 以本地代码验证后记录，不凭文件名猜调用图。

遗留文件只增加窄桥接调用/加载配置/管理入口，以及共享 provider 请求所必需的最小提取。禁止整文件格式化、批量重命名或顺手改造高亮。

## 4. 数据放哪里

新建扩展自身 origin 下的 IndexedDB：`lingkuma-anki-v1`。不要在网页 origin 的 IndexedDB 存储。四个 object store 足够：

- `captures`：key = captureId；含内容、原始输入、关联信息；按 termKey、updatedAt、deliveryState 建索引。
- `jobs`：key = `${captureId}:${kind}`，kind 为 enrich / push / media；同类同记录只有一个待执行工作。
- `media`：key = 内容哈希；受限音频字节、MIME、大小等，不存任意资源。
- `meta`：schemaVersion、本机设置/凭证、迁移信息。不得进入现有 WebDAV/云端同步，也不随默认备份导出密钥。

只有后台 repository 写这些 store。内容脚本和管理页通过受限消息调用，不各自读改数据库。

创建 capture 与相应 job 在同一个事务中提交。编辑内容、增加 revision、更新 dirtyFields、合并 push job 也在同一事务中提交。

**不得在 IndexedDB 事务中 await 网络、哈希计算、TTS 或任意长异步操作。** 在事务外做准备，事务内只执行数据库操作并等待完成事件。

使用 schemaVersion 和显式升级函数；升级失败不可删库重建。存储失败时返回失败，不伪造已保存状态。

## 5. 摘录身份

### 5.1 不可变的原始输入

`originSnapshot` 记录最初的 language、term、contextText、targetStart、targetEnd、contextQuality、结构化 source。targetStart/end 为 JavaScript UTF-16 索引；满足：

`contextText.slice(targetStart, targetEnd) === term`

先裁去所选文本首尾空白，并同步调整边界。不得拆开代理对；来自分词/选择适配器的目标应是完整字符/字素。

### 5.2 v1 规范化和哈希

定义 `N(s) = s.normalize('NFC').replace(/\s+/gu, ' ').trim()`，保留大小写和标点，不转 lemma，不进行 AI 语义判断。

- `normalizedContext = N(contextText)`
- `normalizedTerm = N(term)`
- `normalizedEnd = N(contextText.slice(0, targetEnd)).length`
- `normalizedStart = normalizedEnd - normalizedTerm.length`
- 检查 `normalizedContext.slice(normalizedStart, normalizedEnd) === normalizedTerm`。

检查失败属于输入/定位问题，不可以改为对整句 replaceAll。适配器应退回真实的有界上下文或 selection_only 形式并明确标注，不能选错同形词。

正常完整/片段上下文身份：

```text
captureId = "lk1_" + hexLower(SHA256(UTF8(JSON.stringify([
  1, normalizedLanguage, normalizedTerm, normalizedContext,
  normalizedStart, normalizedEnd, contextQuality === "selection_only" ? fallbackSourceKey : ""
]))))
```

normalizedLanguage 是本次明确语言标识的小写形式；不在后台随 AI 结果改写。数组顺序固定，不能换成无序对象序列化。

正常情况下来源 URL 不参与身份：同一个词在同一个实际句子同一个位置，不因跟踪参数、转载页面或不同设备而重复收录。记录保留首次来源；重复点击只更新本地 lastSeenAt，不修改已写入字段。

selection_only 时没有足够语境，fallbackSourceKey 使用适配器给出的稳定文档身份与可用定位；网页保留有内容意义的 URL 参数/路由，不一概删除整个 query/hash。真实词语只是相同但语境拿不到时，不能声称已完成跨来源精确去重。对 blob 阅读器应提取实际文档身份，不能用临时 blob URL 作为长期身份。

展示分组 termKey 可使用 language + 规范化小写词形；分组不产生数据合并，也不参与 Anki 的唯一性判断。

用户事后修改释义、显示原句或目标词时，原始 originSnapshot 和 captureId 不变，继续更新原笔记。重新打开最初查询仍命中原记录。

## 6. Capture 的最小结构

以下是字段约束，不要求迁移为 TypeScript：

```text
Capture {
  schemaVersion: 1
  captureId, termKey
  originSnapshot                       // 不可变，决定身份
  content { term, contextText, targetStart, targetEnd,
            meaning, sentenceTranslation, reading, usage, userNote, source }
  contentState: pending | ready | failed
  contentRevision: integer             // 有效材料变更递增，不是点击计数
  enrichmentGeneration: integer        // 使迟到的生成结果失效
  dirtyFields: Set<AnkiFieldName>       // 需向 Anki 提交的字段意图
  active: boolean                      // false 表示停止管理，不代表删除 Anki
  createdAt, updatedAt, lastSeenAt
  mediaState: disabled | pending | ready | unavailable | failed
  mediaHash?, ankiMediaFilename?
  destination { expectedProfile?, deckName, modelName }?
  link {
    noteIdHint?, wasLinked: boolean
    deliveryState: pending | synced | conflict | remote_missing | blocked
    baseFields?                        // 上次核实的受管字段原始字符串
    pendingWrite?                      // 未确认的远端写入意图，见第 8 节
    lastVerifiedAt?, lastError?
    observedRemoteFields?              // 差异处理用，不自动覆盖本地
  }
}
```

`waiting_content`、`writing`、`waiting_for_Anki` 是由 contentState、job lease、lastError 推导的显示状态，不额外堆一批相互矛盾的布尔值。

队列任务包含 kind、captureId、requestedRevision/generation、attemptCount、nextAttemptAt、leaseOwner、leaseUntil、lastError。过期租约可恢复；所有完成写回检查 leaseOwner/代数，旧任务不能提交新状态。

## 7. 内容生成与 UI 生命周期

落盘完成立即返回 DTO，再调度 enrichment。AI 只接收用户选中的词/短语及有界上下文，不发送整页、Cookie、API密钥所在配置或整本词汇库。

优先复用当前项目的 provider 配置/传输能力，提取一个不依赖 window/highlightManager/tooltipEl 的窄适配。不能在后台直接运行整份 a3 脚本，也不能抓 tooltip.innerHTML 当业务数据。

自动查词进入本功能时，以新的持久化语境任务作为该条语境释义的唯一来源：popup 订阅它，note-builder 使用它。原有普通词典、发音、手动深度分析保留；不能让遗留自动 AI 路径同时发第二次同功能请求。

每次生成保留 captureId + enrichmentGeneration。用户编辑/重生成会使旧 generation 失效；迟到结果可丢弃或存诊断，不覆盖已编辑材料。普通重复点击不重生成。人工编辑导致generation失效后，如果meaning仍未就绪，应为新generation保留/更新生成任务；不能取消旧结果后让记录永久卡住。已有效的人工meaning不被自动重生成覆盖。

有效 meaning 才把 contentState 改为 ready 并投递 push。句子翻译/读音可缺失，不要求补全所有可选字段才制卡。错误字符串、JSON残片、“翻译中”不能成为 Meaning。

## 8. 可靠写入：核心算法

### 8.1 先定位，再决定操作

生产流程只通过 anki-client 调用 AnkiConnect。请求统一带 version=6，检查 HTTP、JSON 和 `error`；`result:null` 对某些写操作是正常结果，不能据此判失败。

每次写入前核对目标配置和笔记身份。noteId 只是缓存，不是永久身份：通过 CaptureId 查询并用 notesInfo 校验。

- 0 条匹配 + 从未关联：可以创建。
- 0 条匹配 + 曾关联：remote_missing，不自动创建。
- 1 条匹配：关联该条；确认字段类型兼容；不直接覆盖。
- 多条匹配：冲突，停止该条自动写入，不任意选第一条。

若已缓存的 noteId 仍存在但 CaptureId 不符，停止并按稳定 ID 查找；不能将别人的笔记改成自己的。

### 8.2 创建与超时恢复

在发出 addNote 前，先把 `pendingWrite = {opId, kind:create, sentRevision, intendedFields, previousBase:null}` 事务落盘。

新增笔记第一字段就是 CaptureId，`allowDuplicate:false`；查询按稳定 ID，不按英文词本身去重。不同语境同一个词必须能同时存在。

成功响应后读取 notesInfo，确认身份和提交字段实际一致，再保存 baseFields、wasLinked、noteIdHint、lastVerifiedAt，清理 pendingWrite。

若请求超时/worker中止/返回值丢失：不能由 HTTP client 自动重发 addNote。恢复时先查 CaptureId：找到本次 intendedFields 就确认成功；找不到且确属从未关联才重试创建；多条/内容不符进入差异流程。重复字段错误也要重新查找，不无限重试。

### 8.3 更新与未确认操作

更新前一样持久化 pendingWrite，包含 sentRevision、previousBase 和 intendedFields。只调用 updateNoteFields 更新需要修改的字段，不删除重建。

恢复未确认操作必须在普通“是否远端改过”比较之前执行：

- 远端等于 intendedFields：这是自己的上次写入已成功，确认它，不误报人工冲突。
- 远端仍等于 previousBase：尚未观察到本次写入，可再次依据最新意图协调。
- 其余：保存两个版本并标冲突，不盲目重放。

核实某次 sentRevision 成功，不等于本地当前最新 revision 已成功。用户期间又修改了内容时，只清除已实际提交且当前值仍匹配的 dirtyFields；保留新修改，继续排队。

### 8.4 base / desired / remote 三方比较

base = 上次已核实的受管字段原始字符串。
desired = base 的副本，仅用本地 dirtyFields 的安全渲染结果打补丁。
remote = notesInfo 读到的同一字段集合。

- remote == desired：确认一致，必要时更新基线；不重复写。
- remote == base 且 desired != base：可提交本地改变。
- remote != base 且不等于 desired：显示差异，暂停该条；不默认为远端赢或本地赢。

首次在另一台电脑找到已有相同 ID 笔记但没有本地基线：不拿刚生成的不同 AI 结果覆盖它。优先采用远端为基线/展示来源，取消冗余的未提交生成；保留不同的本地已编辑材料为差异候选。

保留远端版本后，保存其原始字段字符串作为 baseFields；管理页只用安全的纯文本/受控展示。未编辑的字段原样沿用基线，避免 HTML→纯文本→HTML 往返导致永远 dirty。用户只改 UserNote 时，不重写其他富文本字段。

模板/CSS、卡片牌组/复习状态、用户额外标签不是普通内容更新的受管字段，不要纳入每次对比后强制恢复。插件只维护自身明确命名空间的标签，不清空用户标签。

**一致性边界：**普通 AnkiConnect 读/写调用不构成数据库 CAS。读前检查＋写后核实能处理已观察到的差异及中断恢复，但不能承诺用户恰好在两次调用之间编辑同一字段时绝不被覆盖。不可虚构“原子双向同步”；检测忙/无法核实时等待重试，不绕过安全检查。

## 9. 调度与断点恢复

一个后台执行器即可。AI 并发上限 2，Anki写入串行；任务去重来自数据库键，不来自弹窗 Set。

使用扩展 alarms 唤醒；启动、查询落盘、设置修复、管理页打开都可以触发 drain。重要闹钟在后台每次启动时检查/重建。不靠永久 setInterval 或人为维持 worker 永不退出。生命周期及alarms依据见 `SOURCES.md` 的 R4、R5。

任务含有限租约与单次网络超时；处理分批有预算，下一批由已有任务/闹钟继续。网络操作均在事务外。只有租约持有者可提交结果。

Anki 离线采用全局连接退避，避免 500 条记录各失败一次；建议 1/2/5/15 分钟上限退避，恢复后自动继续。认证、配置、字段不兼容属于 blocked，设置变化后再试，不高频轮询。

AI 网络/限流有界自动重试，尊重可用 Retry-After；格式错误允许有限修复重试，不能无限消耗。达到上限后本地记录仍在，集中重试可选。

已关联本地记录可低频分批核对外部变化；打开记录或本地修改前立即核对。只检查自己关联的记录，不定时下载整个 Anki collection。

## 10. 媒体与备份

媒体任务另带由当前term/language/voice决定的inputKey；迟到的旧词音频不得写给已经修改过目标的新内容。

媒体先写到本地受限缓存，再上传到 Anki；使用内容哈希确定安全 ASCII 文件名，保存 API 实际返回的文件名。上传成功后将 Audio 字段意图交给同一个 sync-service。

上传后写字段失败，下次不创建新笔记、不换随机文件名反复上传。音频失败保持文字 synced 并独立显示 media failed。不开启自动删除远端“孤儿媒体”，防止删掉其他笔记共享的声音。

备份包含 schemaVersion、原始证据、材料和必要关联元数据；不包含凭证、锁、未确认网络操作的可重放命令。导入先验证、去重和保留冲突，不覆盖新内容；恢复的关联标为待核实。检查实际 Anki 后才能再写。

## 11. 必须始终成立的不变量

- 相同 captureId 的并发主动查询只有一条本地记录和一个同类任务。
- 显示“本地已保存”意味着事务已提交；显示“已写入 Anki”意味着当前提交已核实，而非仅发出请求。
- 无有效 meaning，不创建可复习的错误/空白卡片。
- 同一正常查询链路只有一份语境生成任务；UI关闭不取消已保存工作。
- 任何完成回调都不能将结果写给另一个 captureId 或旧 generation。
- 未确认写入先 reconcile；不盲目 retry addNote。
- 删除/外部修改/重复 ID 不通过自动重建、覆盖或删除“解决”。
- Anki同步与复习完全不在本系统职责内。
- 遗留词汇熟悉度、存储、同步格式和正常查词不因新增模块被替换。
