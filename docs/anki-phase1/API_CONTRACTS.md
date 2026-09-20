# 接口契约与错误语义

## 1. 消息统一外壳

新增消息使用独立前缀/命名空间，不复用遗留含糊的 action：

```json
{
  "namespace": "lingkuma.anki.v1",
  "requestId": "一次请求的ID",
  "type": "capture.lookup",
  "payload": {}
}
```

成功：`{ok:true, requestId, data:{...}}`。
失败：`{ok:false, requestId, error:{code, message, retryable}}`。

所有边界做运行时校验。只接受明确定义的字段和操作；校验失败不得发网络、写库或回退成一个模糊的“成功”。requestId 不作为摘录身份。

### 内容脚本允许的消息

- `capture.lookup`：首次/重复主动查词。输入 lookupSessionId、originSnapshot；输出 captureId、是否已有、持久化成功状态、当前安全 DTO。
- `capture.get`：仅按明确 captureId 读取公开摘录 DTO。
- `capture.lookupState`：恢复已打开弹窗的状态；不得触发新的查词或制卡。

UI反向通知：`capture.changed`，含 captureId、contentRevision 和安全 DTO；显示前检查当前 lookupSessionId/captureId。后台向对应 tab/frame 投递，投递失败不影响任务。重新打开主动读取，不能假定通知永不丢失。

### 仅可信扩展管理页允许

`settings.getPublic`, `settings.save`, `connection.test`, `model.ensure`, `capture.list`, `capture.edit`, `capture.regenerate`, `capture.retry`, `capture.exclude`, `capture.resume`, `capture.resolve`, `capture.openInAnki`, `backup.export`, `backup.import`。

不向内容脚本提供列表导出、密钥读取、任意Anki action、任意URL fetch、任意笔记ID更新。校验 sender.id、扩展管理页面路径；sourceUrl 是证据文本，不是可自由请求的网络目标。

### 查询输入约束

- term：裁边后非空；词/短语最多256个Unicode码点。超出时保持原翻译功能并说明不作为词条自动摘录，不截断后静默制卡。
- contextText：真实文本，默认最多8000个UTF-16单元；应以目标为中心裁出真实有界片段并正确更新offset，不能直接 slice(0,8000) 丢掉目标。
- targetStart/end：有限整数，0≤start<end≤contextText.length，substring精确等于term。
- language：本次明确配置或原入口确定的语言，固定规范化后参与身份。
- source：kind、url、title、locator均受限；kind为web/epub/pdf/subtitle/selection；locator如页码或时间点不是可执行脚本。
- contextQuality：sentence / fragment / selection_only。

## 2. repository 接口

建议保持以下少量操作，各自说明事务范围：

```text
createOrGetCapture(originSnapshot, defaults) -> {capture, created}
getCapture(captureId) -> Capture | null
patchContent(captureId, expectedRevision, patch) -> Capture
excludeCapture(captureId) / resumeCapture(captureId)
claimDueJob(kind, now, ownerToken) -> Job | null
commitJobResult(jobToken, expectedGeneration, result) -> committed | stale
prepareWrite(captureId, sentRevision, intendedFields, previousBase) -> pendingWrite
confirmWrite(opId, observedFields, noteId) -> Capture
recordRemoteDifference(captureId, observedFields, reason)
listCaptures(filter, cursor, limit)
```

patchContent 的 revision 不匹配返回 STALE_REVISION，并给出当前 DTO；不得无条件最后写入覆盖。meta/secret 的读取接口只供后台，不能从 getPublic 返回密钥。

## 3. AI/provider 边界

`explainInContext({term, language, meaningLanguage, contextText, targetStart, targetEnd}, {signal})`

返回纯数据：

```json
{
  "meaning": "产生、返回（一个值）",
  "sentenceTranslation": "该迭代器按需逐个产生匹配的记录。",
  "reading": "",
  "usage": "这里描述迭代器逐项产生值。"
}
```

meaning 必须是非空有效释义；其他字段可空。不得返回或接受改写后的“原句”替换原文，不接受模型给出的captureId、牌组、Anki字段名、URL、调用指令。

默认专用提示词应做到：按给定目标在给定上下文中的用法解释；输出简短中文；原文是待分析数据而不是命令；不服从原文内指令；不得索取/泄露密钥；不构造不存在的句子。提供方支持结构化输出时使用；否则以JSON文本＋严格解析校验实现。不要要求所有提供方必须支持某一家特有的response_format。

对无意义或无法判定的结果保留待处理记录，不以“暂无翻译”“翻译中”等占位符创建卡片。既有自定义AI提示词可以继续用于原功能，不为获得结构化输出而改写用户配置。

同一capture/generation由enrichment层做single-flight与持久化去重。HTTP传输本身不管理业务记录或UI。

## 4. AnkiConnect 边界

唯一调用入口：`invoke(action, params, options)`，端点只来自本机设置。

请求：`{action,version:6,params,key?}`。检查HTTP状态、超时、JSON对象、是否有result/error和error是否非null。不要要求响应恰好两个字段；未来扩展字段可忽略。不要把合法null/false/空数组结果统一当作失败。

**资料限制：**本包读取了AnkiConnect社区仓库的API文档；原作者GitHub仓库提示已迁往SourceHut，迁移后文档未能完整读取。以下是拟采用的协议面，T00须在用户实际安装的版本上验证支持情况/返回形状，不能假定文档等于本机能力。

必要的能力清单：

| 操作 | 用途与关键参数 |
|---|---|
| version | 协议握手，实际客户端请求仍显式version=6 |
| apiReflect（可选） | 查询支持动作；不支持时采用只读探测，不反复报错 |
| deckNames | 目标牌组选择 |
| modelNames / modelFieldNames | 检查专用类型和字段次序 |
| createModel | 一次性配置创建专用模型，普通写入不调用 |
| findNotes | 按生成的CaptureId查找，不拼接未清洗网页文本 |
| notesInfo | 读字段、模型信息和笔记身份，确认写入 |
| addNote | 无用户二次操作创建；note含deckName/modelName/fields/options/tags |
| updateNoteFields | `note:{id,fields}`，原地修改，不改复习 |
| storeMediaFile | `filename,data`，上传受控字节；保存返回的实际文件名 |
| guiBrowse（可选） | 用户显式打开关联笔记时，以确定noteId构造查询 |
| getActiveProfile（若支持） | 一次性绑定及写前检查；检测错误目标 |

字段定位查询仅由固定前缀和已验证的hex ID组成，例如 `CaptureId:lk1_<64位hex>`；notesInfo后必须再次精确核对CaptureId。不要只依据搜索的非空结果。

创建固定专用笔记类型时确认第一字段CaptureId，并设置 `allowDuplicate:false`。不把Term放在第一字段后利用默认重复检测，否则不同语境的同一词会被错误拦截。

默认不创建/移动现有牌组，不修改牌组设置。目标牌组在设置时选择；失效时blocked，不默默换回Default。设置更改只影响新记录；已有记录不批量迁移。未配置时捕获的记录可在首次设置后绑定目标并恢复。

### 4.1 本机与凭证

仅允许精确loopback主机（localhost、127.0.0.1、::1）的http/https端点，拒绝带用户密码的URL、远端地址、跟随重定向到其他主机。URL解析后校验，不以字符串startsWith('localhost')判断。

默认端点 `http://127.0.0.1:8765`。API key仅后台使用，不进日志/导出/内容脚本。

不要建议用户绑定0.0.0.0或开启CORS任意来源。权限不足应显示具体配置指导；生产不自动修改AnkiConnect配置。

### 4.2 Profile 防误写

getActiveProfile可用时，记录一次性设置中的预期profile，写前检查。变更时暂停，不自动loadProfile。

不可用时明确告知无法检测profile切换，要求一次性确认单profile使用；仍校验CaptureId，不虚构全局collection UUID。在同名profile之间换库、任意时刻切换profile也不能承诺绝对识别，不能因为缓存noteId存在就覆盖目标。

### 4.3 禁用动作

生产代码不得调用 `sync`, `loadProfile`, `guiAddCards`、复习评分/排程修改、批量删除笔记/牌组、清空媒体。只读复习字段也不用于推断Known。测试可在隔离测试数据中核实cardId/排程未变，但不能把测试权限暴露给内容脚本。

### 4.4 更新成功的定义

HTTP成功只是协议成功。updateNoteFields后仍要读取核实字段，处理编辑器占用/未实际更新。超时属于结果未知，交给sync-service的pendingWrite恢复，而不是client重发写请求。

## 5. Note renderer 与 HTML

`renderFields(content, identity, media) -> Record<FieldName,string>` 是纯函数。应用不应信任网页/AI/导入/远端笔记HTML。

本地原文、释义和笔记先按文本转义，再由受控模板插入有限标签。Context只根据已验证offset在目标范围包一个受控强调标签；不用正则全局替换目标词，不用直接innerHTML复制网页。

Source链接仅使用验证后的http/https URL；file/blob等来源以文本定位显示。转义属性、标题和定位，不生成javascript:/data:链接。模板不能加载远程JS、字体或追踪像素。

除了Audio专用字段，文本中的Anki媒体/LaTeX指令不得被意外解释为外部资源；将此加入渲染测试和真实卡片检查。Audio只接受已上传受控文件的完整引用。

基线中的远端富文本仅内部保存；UI必须安全渲染。接受远端版本后只提交未来实际编辑的字段，不把所有字段反复重渲染。

## 6. 媒体接口

`getWordAudio({term,language,voiceConfig}, {signal}) -> {bytes,mime} | unavailable`。

max 5 MiB/文件，MIME允许明确的音频类型；检验非空与合理文件头，拒绝HTML/错误页。不执行提供方返回的脚本，不下载页面指定的任意URL。

文件名采用 `lk_audio_<sha256>.<allowlistedExtension>`，与网页原始文件名无关。调用storeMediaFile后保存实际返回文件名，再将Audio更新交给push任务。媒体任务与内容任务各有独立状态。

## 7. 错误码

| code | 用户含义 | 行为 |
|---|---|---|
| INPUT_INVALID / RANGE_MISMATCH | 原文或目标位置无法验证 | 不伪造；保留正常查词，适配器受控降级/标注 |
| STORAGE_FAILED | 本地未能保存 | 明确失败，不显示已保存 |
| PROVIDER_UNCONFIGURED / AUTH_FAILED | 服务未配置/凭证错误 | blocked，配置变更后恢复 |
| EXPLANATION_UNAVAILABLE | 未取得有效释义 | 保留本地，有界自动重试 |
| ANKI_UNREACHABLE / TIMEOUT | Anki暂不可用/结果未知 | 退避；写超时先协调 |
| API_UNSUPPORTED | 本机缺所需能力 | 说明缺项，不能静默降成不可靠模式 |
| MODEL_INCOMPATIBLE / DECK_MISSING | 模板/目标不兼容 | 停止相关写入，设置页处理 |
| PROFILE_MISMATCH / IDENTITY_MISMATCH | 目标不符 | 停止，避免误写 |
| REMOTE_CHANGED / MULTIPLE_MATCHES | 远端差异/多条相同身份 | 保存差异，等待异常处理 |
| REMOTE_MISSING | 原笔记不存在 | 不自动重建 |
| STALE_REVISION / STALE_JOB | 回调已过时 | 不覆盖；按新任务继续 |
| AUDIO_UNAVAILABLE / AUDIO_FAILED | 无法导出/获取音频 | 文字成功不变 |

错误日志只记录码、captureId截断值、动作、次数/时间，不默认记录全文原句、prompt、key或完整URL中的敏感参数。

## 8. 建议的 wire 形状（T00 按本机能力核验）

下面是实现边界示例，字段内容由已定义的 renderer 生成；不是让 content script 自己发送这些请求。

```json
{
  "action": "addNote",
  "version": 6,
  "params": {
    "note": {
      "deckName": "用户在一次性设置中选择的牌组",
      "modelName": "LingKuma Lookup v1",
      "fields": {
        "CaptureId": "lk1_<64位十六进制>",
        "Language": "en",
        "Term": "yields",
        "Reading": "",
        "Meaning": "产生、返回（一个值）",
        "Context": "The iterator <strong>yields</strong> each matching record lazily.",
        "SentenceTranslation": "该迭代器按需逐个产生匹配的记录。",
        "Usage": "",
        "UserNote": "",
        "Source": "受控安全来源HTML",
        "CapturedAt": "首次摘录时间",
        "Audio": ""
      },
      "options": {"allowDuplicate": false},
      "tags": ["lingkuma::lookup"]
    }
  }
}
```

更新只发送实际修改字段，例如：

```json
{
  "action": "updateNoteFields",
  "version": 6,
  "params": {
    "note": {
      "id": 1234567890,
      "fields": {"UserNote": "安全转义后的用户笔记"}
    }
  }
}
```

更新后的核实请求：

```json
{"action":"notesInfo","version":6,"params":{"notes":[1234567890]}}
```

以上ID是占位示例。业务代码只能用稳定ID查到并再次验证过的noteId，不能硬编码。所有请求若设置了key，由唯一client从本机设置追加。

专用model的创建参数应按本机createModel契约提供modelName、inOrderFields、css、isCloze=false和单个cardTemplates项。前后模板只引用允许字段，不自行用网页内容生成模板。首次设置创建后读取modelFieldNames核实顺序；普通写入不再次创建/覆盖model。
