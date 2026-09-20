# 一期构建与发布核对

本记录对应 T21/A50。详细逐任务证据和未运行项见 `PROGRESS.md`；本文件不把 mock 结果写成真实 Anki、浏览器或付费提供方结果。

## 可重复门禁

新 checkout 使用 Node.js 24：

```sh
npm ci
npm run test:anki:release
```

`test:anki:release` 顺序执行：

1. unit tests；
2. integration tests（先 clean Chromium build）；
3. 默认 E2E（真实 Anki 用例明确 skip）；
4. clean Firefox build；
5. `scripts/verify-anki-builds.mjs` 产物检查。

CI 工作流 `.github/workflows/anki.yml` 在 Anki实现、测试、manifest和构建文件变化时运行同一门禁。CI 不访问用户 Anki、API key、付费 AI 或音频渠道。

## 构建产物

| 目标 | 命令 | 目录 | 后台清单 |
|---|---|---|---|
| Chromium / Edge | `npm run build` | `dist/` | Manifest V3 `background.service_worker` |
| Firefox | `npm run build:firefox` | `dist-firefox/` | Manifest V3 `background.scripts` |

产物检查要求两套目录均包含 manifest、后台bundle、隔离Anki content facade、设置页、管理页和popup；options/popup各自只能加载一次bundle。Firefox产物不得包含`service_worker`、`offscreen`或`sidePanel`权限。

## 当前实测记录

- AnkiConnect：协议6，profile“账户1”，真实专用牌组`LingKuma Phase1 Acceptance`和笔记类型`LingKuma Lookup v1`完成A49；测试结束后牌组笔记数为0。
- Chromium：Chromium 150加载最终产物，覆盖真实鼠标查询、短语、受控reader入口、管理/备份页面和敏感选择守卫。
- Firefox：官方Firefox 156.0通过`web-ext`临时安装`dist-firefox`；修复Firefox后台清单和重复bundle注入后，当前会话无LingKuma脚本错误。
- Firefox lint：0 error、0 notice、99 warning。warning来自遗留非Anki页面的动态`innerHTML`、Firefox不识别的`tts`权限等；未伪装为零warning。
- 真实Anki：一次设置→查询→创建→本地编辑→断网→恢复→外部编辑冲突→逐字段合并→备份通过；addNote一次，provider一次，常规逐词保存/确认点击0次，生产`sync/loadProfile/guiAddCards/changeDeck/setDueDate`调用0次。

## 发布前人工项

以下环境相关项未纳入自动门禁，运行时必须继续使用专用测试数据：

- 品牌Chrome/Edge人工加载；
- 外部EPUB应用、PDF.js和真实视频网站联合写卡；
- 真实付费AI与Supertone、Anki媒体上传和Reviewer播放；
- 已人工复习卡片更新后的排程观察；
- 真实系统睡眠、浏览器worker强杀及恢复。

这些项在`PROGRESS.md`保持“未运行”，不能因自动化通过改写为“通过”。AnkiWeb/移动端同步不属于一期职责。

## 文档核对

- 用户操作、状态、音频、冲突、备份、停止管理和多设备边界：`USER_GUIDE.md`。
- 模块边界、schema、消息/API、构建、自动/真实测试和脱敏诊断：`DEVELOPMENT.md`。
- A00～A50证据及真实限制：`PROGRESS.md`。
- 产品和一致性不变量：`SPEC.md`、`ARCHITECTURE.md`、`API_CONTRACTS.md`。
