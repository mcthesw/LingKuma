# Anki phase 1 implementation baseline

Recorded: 2026-09-20.

## Repository and toolchain

- Branch: `main`.
- Starting commit: `b9103a196ca15f3789588098ae858d3224e1468a`.
- Worktree before T00: clean and tracking `origin/main`.
- Node: `v24.19.0`.
- npm: `11.14.1`.
- Dependency install: `npm ci` completed with 186 packages; npm reported only deprecation warnings in transitive packages.
- Existing automated test command: none in the root `package.json`.
- Build command: `npm run build`.
- Baseline build result: PASS. Webpack 5.98.0 completed in 1.64 s with two size warnings and no errors.

## Build and runtime loading

`webpack.config.js:14-58` defines separate classic-script entries. `webpack.config.js:59-184` preserves the source paths for the service/content/background outputs and sets `output.iife=false` and `output.module=false`. `CleanWebpackPlugin` runs at `webpack.config.js:208-210`, so a second compiler must not race with or have its product removed by this build.

Chrome uses the single `background.js` service worker (`manifest.json:29-31`). Firefox declares the same file as both service worker and background script (`manifest-firefox.json:29-35`). Any Anki background runtime therefore has to be included in that one artifact and initialize idempotently in either host.

The active highlighter runtime is injected dynamically from `background.js:24-55`. The relevant order is:

```text
... legacy dependencies
→ src/service/a3_aiFragen.js
→ src/service/a4_tooltip_new.js
→ src/service/a5_custom_word_selection.js
→ src/service/a6_custom_highlight.js
→ ...
→ src/plugin/tts.js
→ src/plugin/edge_tts.js
→ src/plugin/orion_tts.js
→ src/content.js
```

`injectHighlightRuntime` (`background.js:206-247`) checks a per-frame sentinel and calls `chrome.scripting.executeScript` with that ordered list. The phase-one content facade must load before a3/a4/a5 without changing the global classic-script behavior of existing entries.

## Active lookup entry points

### Word lookup

The user pointer path is:

```text
handleA4PointerActivation (src/service/a4_tooltip_new.js:9856)
→ handleMouseMoveForTooltip (src/service/a4_tooltip_new.js:5884)
→ showEnhancedTooltipForWord (src/service/a4_tooltip_new.js:1000)
```

`handleA4PointerActivation` captures click/tap intent and passes the current explosion-reader range/sentence in `activationContext` (`src/service/a4_tooltip_new.js:9872-9887`). This is the semantic active-lookup seam. Hover previews and generic tooltip redraws are not capture triggers.

### Phrase lookup

`handleCustomWordLookup` (`src/service/a5_custom_word_selection.js:406`) is invoked only by the existing phrase action (`src/service/a5_custom_word_selection.js:345-347`). It resolves the context sentence, hides the selection popup, clears the browser selection, then opens the normal tooltip through `showEnhancedTooltipForCustomWord` (`src/service/a5_custom_word_selection.js:625-637`).

There is an existing geometry bug relevant to capture: `hideCustomWordSelectionPopup` clears `lastSelectionRect` at lines 393-400 before `handleCustomWordLookup` tries to use it at lines 419-438. Phase one must freeze the Range, selected text, rectangle, source and bounded context before hiding the popup.

### Reader surfaces

The same injected a4/a5 path runs in injectable web frames, including the existing browser-based EPUB/PDF readers. YouTube/subtitle text is explicitly allowed by `src/content.js:173-193` and reaches the shared word/sentence lookup path. Phase one should preserve source-specific locator data when the existing surface exposes it; it must not create new readers, OCR or transcription.

## Existing AI behavior

`makeAIRequest` in `src/service/a3_aiFragen.js:396-413` forwards provider requests to the background `makeAIRequest` message. `handleAIRequest` in `background.js:2617-3045` resolves the current `aiConfig`/profile and performs the provider fetch.

Automatic contextual paths currently overlap the new feature:

- `fetchAIWordTranslation` (`src/service/a3_aiFragen.js:118`) is invoked during tooltip rendering at `src/service/a4_tooltip_new.js:3810`.
- `fetchAIWordTranslation2` (`src/service/a3_aiFragen.js:321`) is invoked at `src/service/a4_tooltip_new.js:4033`.
- `fetchSentenceTranslation` (`src/service/a3_aiFragen.js:716`) is used by existing example-sentence actions at `src/service/a4_tooltip_new.js:2001`, `2702` and `4110`.
- `fetchAIWordTranslation` can append translations to the legacy vocabulary database and update local cache (`src/service/a3_aiFragen.js:183-284`).

The Anki enrichment adapter must reuse the provider transport/configuration while returning pure structured data. For captured active lookups, its persistent enrichment result becomes the single contextual explanation source for the tooltip and note. Manual deep analysis, ordinary dictionary data, sentence saving and vocabulary-status behavior remain separate and must not be removed.

## Existing TTS behavior

`src/player/offscreen.js:311-322` accumulates Edge TTS audio parts and exposes a complete `audio/mpeg` Blob. Word playback obtains the complete result at `src/player/offscreen.js:738-745`. This is the first export candidate because it already materializes bytes; browser `tts`/speech synthesis playback is not an export channel.

No production API currently returns those bytes to the Anki runtime. Real export, MIME/header validation, size limiting, media upload and playback remain unverified until T15/T20.

## Browser test availability

- Google Chrome `153.0.8010.50`: installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Microsoft Edge `154.0.4258.24`: installed at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
- Firefox: not found in the standard installed locations. Firefox runtime acceptance is not yet run and cannot be marked passed.

A00 evidence is the commands and entry map above. No business behavior or real Anki data was changed by T00.
