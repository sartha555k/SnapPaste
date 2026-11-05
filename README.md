# SnapPaste

Capture what you see. Paste what you need.

A macOS menu-bar utility with a compact paste menu near the insertion point. It extracts and reformats visible screenshot content; it does not explain screenshots, diagnose errors or provide unsolicited advice.

## Download

[Visit the SnapPaste website](https://snappaste-download.vercel.app/) for the interactive demo and installation instructions, or [download the Mac installer](https://snappaste-download.vercel.app/downloads/SnapPaste-macOS-arm64-0.2.0.dmg) directly.

The v0.2.0 preview is for Apple silicon Macs. macOS may flag the installer on first launch because the build is not notarized.

## Run

Requires macOS, Node.js 22.12+ and Apple Command Line Tools. Full local document/table recognition requires macOS 26+. Earlier versions retain local OCR and can use AI for supported transformations.

```sh
npm ci
npm start
```

Add Jev and OpenAI keys in Settings and enable cloud processing. Development can also use a git-ignored `.env` with `OPENAI_API_KEY` and `JEV_API_KEY` (or `TYPESAFE_API_KEY`). Never put provider secret keys in renderer code or committed files.

## Workflow

1. Capture with **Command+Option+S**, import images, or take a standard macOS screenshot saved to the configured screenshot folder. Optional clipboard monitoring also detects copied images.
2. Local OCR begins in the background. Jev makes **one Choice request** over the predefined subcategories; the selected subcategory determines its four saved options. No action-ranking request is needed.
3. Local table recognition runs alongside classification. By default, text and slot 2 prepare in the background when possible. Turn on **Settings → Boost mode** to prepare all available paste outputs in parallel. This can use additional OpenAI requests even if you do not paste. Selecting an option that is still preparing reuses the same work.
4. Focus your destination and press **Command+Option+V**. The small inline popup shows the recent screenshot and five options. Use **1–5**, **up/down + Enter**, or click. Left/right switches screenshots; Escape dismisses the popup.
5. Output pastes into the destination. A value-extraction action opens an exact-value picker. Recovery actions allow region selection or editing local text. Original-image recovery copies the image for manual Cmd+V.

For multiple screenshots, press **Command+Option+G** for each capture (up to three), then focus your destination and press **Command+Option+P**. Choose **Latest 2** or **Latest 3** to start from recent history instead. **Just the text** combines text locally. The three suggested actions paste their result directly. **Write your own…** lets you enter a prompt and confirm the preview before pasting. Group suggestions and custom prompts use OpenAI when cloud processing is enabled.

Normal Cmd+V is unchanged. Shortcuts are configurable. The menu uses caret bounds when the destination exposes them, then focused-field or mouse-position fallback. Automatic paste requires Accessibility; otherwise the result is copied with a notification. A destination switch also uses copy fallback. The original text field and selected text range are retained while the popup is open, then restored before Paste. Cursor and paste operations run in-process under SnapPaste’s own Accessibility permission; OCR remains in the helper. The clipboard is restored after a successful paste.

## Definitions and caching

Supabase contains the public catalogue: `categories`, `subcategories`, `actions`, and `subcategory_actions`. Only the project URL and **publishable** key are used by `src/main/catalogue.ts`. No secret/service-role key is shipped.

- Startup loads the last valid cache, then refreshes from Supabase in the background.
- Definitions refresh every six hours without a database request during menu opening.
- A bundled copy of the approved 20 categories, 146 subcategories, 72 actions and 584 slot mappings is available on first launch/offline.
- Validation requires four distinct options per subcategory and local text in slot 1. Partial/invalid syncs preserve the last good catalogue.
- The local definition cache is `cache/definitions.json` under Electron's `app.getPath('userData')`, normally `~/Library/Application Support/SnapPaste/`.
- This definition cache contains menu definitions, not screenshot images. Screenshot history and OCR/classification caches are separate files under the same application-support directory.

Catalogue edits are made through SQL/admin access; app clients have read-only access. Classification cache keys include the definition version and Jev settings. Output cache keys also include the screenshot, action and OpenAI model/settings.

## Local-first output

Apple Vision extracts text on-device. On macOS 26+, its document API also recognises table rows and cells. Data detectors extract visible links, emails, phone numbers, dates and addresses; literal hashtags and barcode payloads are also collected.

The app first attempts supported local processing regardless of the database action's initial `ai` assignment:

- Plain text and exact-value picking.
- Visible links/addresses when detected.
- One rectangular table without merged cells: rich table, spreadsheet cells or CSV.
- Formatting an already valid JSON transcription.

Semantic summaries, handoffs, and field-specific extraction use OpenAI initially. Complex/multiple/merged tables use AI fallback rather than guessing cell structure locally. Converting recognised cells to output formats is local. Recognition can still be wrong: outputs remain editable in the library result view.

Jev image support is experimental. A failed or ambiguous classification gets a labelled general menu. AI output can report that the requested information is unavailable instead of inventing it. These paths do not claim verified model understanding or a guaranteed response time.

## History and screenshots

History deduplicates images and persists across restarts. Storage is bounded by a configurable 50–2,000 MB budget (default 200 MB); oldest app-owned captures expire when full. Original imported/source files are not removed. A single image must be at most 20 MB and 40 megapixels.

The folder watcher observes new filenames beginning `Screenshot` or `Screen Shot` in the configured screenshot location (Desktop by default). It does not scan old files. Localised/custom screenshot names may require import. Restart after changing macOS's screenshot save location. Clipboard monitoring is optional and initially off.

## Validation and packaging

```sh
npm run check
npm run package
npm run make
```

The unsigned app is under `out/SnapPaste-darwin-arm64/` on Apple Silicon. Native helper architecture follows the build machine. Signing, notarisation and auto-updates remain release work.

Tests cover catalogue integrity, offline/failed sync, one-request classification routing, ambiguity fallback, local output eligibility, shared prefetch/click work, history durability/quota, popup placement and clipboard formats. Live provider accuracy and third-party paste compatibility require real-device testing.

Main modules: `src/main/catalogue.ts` (sync/cache), `src/shared/catalogue.ts` (validation/menus), `src/main/decisions.ts` (Jev classification), `src/main/local.ts` (local output), `src/main/providers.ts` (AI fallback), `src/main/result-cache.ts` (output deduplication), `src/renderer/Palette.tsx` (inline UI), and `native/SnapPasteHelper.swift` (Vision/focus/clipboard).
