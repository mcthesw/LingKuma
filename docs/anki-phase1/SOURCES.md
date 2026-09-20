# 调研出处与证据边界

查阅日期：2026-09-20。设计中的默认行为是本次用户需求决策，不等于对参考产品当前内部实现的断言。

## R1. LingQ 官方词汇复习教程

标题：Reviewing Vocabulary in Lessons and on The Vocabulary Page。
发布日期：2017-07-20。
地址：`https://www.lingq.com/blog/reviewing-vocabulary/`

支持的结论：官方教程介绍了多种可配置复习活动，并给出“词语和原文片段在正面；词语、翻译、原文片段在背面”的示例。

限制：这是旧教程中的可配置示例，不足以断言2026年所有客户端的固定默认卡面。此项目采用这一简单字段组合来满足用户所说的LingQ式卡片，不复制其复习系统。

## R2. 沙拉查词官方Anki说明

地址：`https://saladict.crimx.com/anki`
备用语言：`https://saladict.crimx.com/en/anki`

支持的结论：生词本保存可触发自动制卡；文档展示Date、Text、Context、ContextCloze、Translation、Note、来源及Audio等字段。

本项目取舍：借鉴结构化保存与自动制卡，但用户最终明确要求“查词即保存”，不能照搬为另点收藏/保存。身份使用稳定captureId而非仅时间；不照搬默认填空。

## R3. 已连接GitHub读取的用户仓库

仓库：`https://github.com/mcthesw/LingKuma`
本次读取 main 指向：`7e9691b2f68210a93eb8a127a7ec7e7ca092f6dc`。

读取的相关文件：

- `webpack.config.js`：多个经典脚本入口、iife:false、禁用模块输出、Copy/Clean流程。
- `src/service/a4_tooltip_new.js` 开头：tooltip/window级状态、AI状态跟踪、词汇详情缓存及自动翻译设置。
- `src/service/a3_aiFragen.js` 开头：fetchLanguageDetection、fetchAIWordTranslation、makeAIRequest调用、aiConfig、自定义prompt和窗口依赖。
- `src/plugin/edge_tts.js` 开头：TTS调用设计/示例与获取音频blob的线索；不是已完成真实TTS运行验证。
- `manifest-firefox.json`：现有后台scripts/service_worker配置与content脚本加载。

本次未在用户本地运行构建、浏览器或Anki，没有对全仓库逐行审计，也没有提交代码。T00/T01必须在实际本地版本上核实入口、运行时兼容和音频导出能力。

## R4. Chrome扩展后台生命周期

地址：`https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle`

支持的结论：后台worker可能退出，内存全局状态会丢失；应持久化关键数据、设计为可恢复。不应以让worker永久存活代替正确状态管理。

## R5. 扩展alarms

地址：`https://developer.chrome.com/docs/extensions/reference/api/alarms`

支持的结论：需要alarms权限；重要闹钟应考虑浏览器/版本差异并在启动时检查。设计不用较新浏览器独有行为作为跨浏览器可靠性前提。

## R6. 跨源网络与内容脚本安全

地址：`https://developer.chrome.com/docs/extensions/develop/concepts/network-requests`

支持的结论：内容脚本与扩展后台的网络权限不同；后台请求应限制资源/动作，不提供任意URL代理；不直接以不可信innerHTML渲染远端数据。

## R7. AnkiConnect协议资料及限制

原作者GitHub地址：`https://github.com/FooSoft/anki-connect`
本次README明确提示迁往：`https://git.sr.ht/~foosoft/anki-connect`

迁移后站点在本次工具环境中无法完整读取。已读取社区仓库README作为API协议参考：
`https://github.com/ankicommunity/anki-desktop-addon-connect/blob/master/README.md`

该文档支持本机HTTP、version/action/params/key以及result/error响应等基础约定。不能据此声称已经验证用户安装版本的全部方法、profile检测或并发编辑保障。T00必须做实际能力探测；API_CONTRACTS中已标明这一限制。

## R8. Anki字段与媒体引用

地址：`https://docs.ankiweb.net/templates/fields.html`

支持的结论：字段名区分大小写；卡片模板使用字段替换；媒体引用应实际存在于字段内容中，而不是在模板中动态拼接文件名。

本项目因此把完整受控声音引用放在Audio字段，用户模板不由普通同步自动覆盖。

## 设计而非外部事实的部分

一查即存、确定性语境身份、单条语境单笔记、模块边界、四个object store、pendingWrite恢复、任务数量/顺序、冲突处理、重试上限和界面文案均为本项目实施规格。

本包未保证浏览器永久运行、两个未同步Anki的全局恰好一次、或普通AnkiConnect读写具有CAS语义。故障恢复测试可以验证具体实现，不会消除底层接口没有提供的原子性边界。
