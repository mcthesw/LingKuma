# LingKuma → Anki 开发与验证

## 模块边界

- `src/anki/content-adapter.js`：隔离世界 facade、真实选区快照、查询状态订阅；不持有 key、endpoint 或任意 Anki action。
- `src/anki/capture-service.js`：主动查询语义入口；先事务落盘，再安排后台工作。
- `src/anki/provider-adapter.js` / `enrichment.js`：有界语境材料、结构化释义、generation 与有限重试。
- `src/anki/repository.js`：IndexedDB captures/jobs/meta/media 事务、revision、lease 和任务去重。
- `src/anki/anki-client.js`：生产环境唯一 AnkiConnect 客户端；精确 loopback、action 白名单、读重试/写单次尝试。
- `src/anki/sync-service.js`：CaptureId 定位、pendingWrite、创建/更新读回、三方差异和显式恢复。
- `src/anki/scheduler.js`：alarms 唤醒、AI 并发 2、Anki 串行、全局退避和批处理预算。
- `src/anki/media-service.js`：受限音频校验、内容哈希缓存、Anki 媒体上传和同笔记 Audio 更新。
- `src/anki/reconciliation-service.js`：已关联记录的单条低频/即时核对；不扫描 collection。
- `src/anki/management-service.js` / `backup-service.js`：可信扩展页管理能力和版本化本地备份。
- `src/anki/background-runtime.js`：应用层装配设置、依赖、调度和消息权限。领域服务不隐式读取全局配置。

不得新增第二套 Anki client、远程 endpoint 代理、content 侧管理能力或基于弹窗生命周期的内存队列。

## 数据与接口

当前 IndexedDB schema 由 `src/anki/repository.js` 管理。核心记录是稳定 `CaptureId`、冻结的 `originSnapshot`、可编辑 `content`、revision/generation、目标 `destination`、媒体状态和关联 `link`。任务记录包含 kind、captureId、requested revision/generation、attempt、nextAttemptAt 和有限 lease。

`CaptureId` 算法及 UTF-16 offset 规则由 `tests/anki/fixtures/identity-v1.json` 固定。改变算法、规范化或字段顺序必须视为显式 schema/协议迁移，不能重新生成 fixture 让测试通过。

消息 envelope 固定为：

```json
{"namespace":"lingkuma.anki.v1","requestId":"...","type":"...","payload":{}}
```

管理消息只接受本扩展 options/manager 页面；capture 消息只接受本扩展 content sender。公开 DTO 不返回 API key、noteId、baseFields、pendingWrite 或远端字段正文。

生产 AnkiConnect 仅允许：`version`、`apiReflect`、`deckNames`、`modelNames`、`modelFieldNames`、`findNotes`、`notesInfo`、`getActiveProfile`、`createModel`、`addNote`、`updateNoteFields`、`storeMediaFile`、`guiBrowse`。不调用 `sync`、`loadProfile`、删除、换牌组或复习排程 action。

详细不变量见 `ARCHITECTURE.md`，wire/error 契约见 `API_CONTRACTS.md`。

## 构建

```sh
npm ci
npm run build
npm run build:firefox
```

- Chromium/Edge 输出到 `dist/`，Manifest V3 后台使用 `background.service_worker`。
- Firefox 输出到 `dist-firefox/`，后台使用 `background.scripts`。
- 两个目录必须独立生成；不要手工替换构建后 manifest。

## 自动回归门

```sh
npm run test:anki:release
```

该命令运行 unit、integration、默认 e2e、Chromium/Firefox clean build 和产物检查。真实 Anki 测试默认跳过，CI 不依赖用户 profile、牌组、key 或付费提供方。

分层命令：

```sh
npm run test:anki:unit
npm run test:anki:integration
npm run test:anki:e2e
npm run test:anki:build
```

## 真实 Anki 验收

只在专用本地 profile/牌组上运行：

```sh
ANKI_REAL_E2E=1 ANKI_TEST_DECK="LingKuma Phase1 Acceptance" node --test tests/anki/e2e/real-ankiconnect.test.js
```

Windows PowerShell：

```powershell
$env:ANKI_REAL_E2E='1'
$env:ANKI_TEST_DECK='LingKuma Phase1 Acceptance'
node --test tests/anki/e2e/real-ankiconnect.test.js
```

该测试会创建或复用专用牌组和生产笔记类型，仅按本轮随机 CaptureId 删除本轮笔记；不会清空牌组、删除 model、调用 AnkiWeb sync 或修改用户复习排程。API key 使用 `ANKI_CONNECT_KEY` 注入，不应写进命令日志或仓库文件。

真实浏览器步骤：

1. Chromium/Edge 以开发者模式加载 `dist/`；Firefox 以临时扩展加载 `dist-firefox/`。
2. 新 profile 中打开设置，完成一次连接、牌组选择和保存。
3. 在测试文章主动查询一个词和一个短语；确认额外保存点击为 0。
4. 关闭 Anki 后再查一条，重启 Anki并观察自动恢复。
5. 在 Anki 手工修改一条、删除另一条，回管理页核对冲突/缺失。
6. 导出备份，在独立测试 profile 导入并核对重新绑定。

真实付费 AI、Supertone 和 Reviewer 播放只有在测试者明确愿意消耗额度/写媒体时运行；未运行必须记录，不能以 FakeAnki 冒充。

## 脱敏故障证据

可记录命令、通过数、错误码、retryable、浏览器/Connect版本、牌组/model名和调用 action 名。不得记录 key、完整请求 body、备份正文、Cookie、私人语境、baseFields、pendingWrite 或用户 collection 内容。
