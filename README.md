# SnapPaste

**Capture what you see. Paste what you need.**

A macOS menu-bar app that turns screenshots and clipboard images into editable text, tables, and useful drafts. Invoke a shortcut from the app you're working in, choose a paste action, review the result, and copy or paste it back.

## Run locally

Requirements: macOS, Node.js 22.12+ (Node 24 LTS recommended), npm, and Apple's Command Line Tools (`xcode-select --install`). Swift compiles the small native helper on first start. An Apple Developer membership is not required for local development.

```sh
npm ci
npm start
```

The main window opens and a clipboard icon appears in the menu bar. Closing the window leaves the utility running. Quit from the menu-bar icon or Cmd+Q.

### Try the real local workflow without keys

1. Click **Or try an example**. This generates an explicitly labeled example PNG and runs real Apple Vision OCR on it. It is not a simulated extraction.
2. Select **Just the text** (or press `1`).
3. Review the extracted text, switch to **Edit** to change it, and click **Copy**.
4. Paste into your preferred app using Cmd+V.

To use your own image, choose **Open image**, or copy an image and click **Use clipboard image**. To capture a region to the clipboard with macOS, press Control+Command+Shift+4. In your destination app, invoke SnapPaste with **Command+Option+V** (configurable in Settings).

**Capture region** starts the native macOS region selector. It needs Screen Recording permission for the app that macOS identifies (Electron while developing; SnapPaste for the packaged app). If a permission change requires a restart, quit and reopen the app. Importing an image or using an existing clipboard image is also supported.

### AI setup

Open Settings and supply your own API keys. Keys are encrypted with Electron `safeStorage` using the macOS secure-storage integration, are never returned to the renderer after saving, and are not stored in this repository. No bundled provider key or proxy server is included.

- **OpenAI:** formatted output, spreadsheet extraction, summaries, bug reports, event/receipt details, and custom prompts. Default model: `gpt-4.1-mini`; change it to a compatible vision + Structured Outputs model available to your account.
- **Jev / TypeSafe:** optional image classification and action relevance decisions. Default pinned model: `jev-1.14.0`. Vision is experimental. If the provider fails, the menu falls back to clearly labeled local text rules.
- **Enable cloud processing** explicitly. With it enabled and a Jev key present, new images are sent to Jev to select contextual actions. Selecting an AI transformation sends the image to OpenAI. Quick text uses local Apple Vision and needs no OpenAI call.
- Existing images are not automatically resent after changing Settings; import/copy again to run the new configuration.

Without Jev, the menu still works using local OCR keywords. This is labeled **LOCAL RULES**, not presented as model analysis. Without OpenAI, only local text extraction is available; AI actions explain which setting is missing. There are no fake AI responses.

### Paste behavior

The first two actions are stable: **Just the text** and **Clean & formatted**. The last two depend on the screenshot's detected category and, when configured, Jev relevance decisions. Custom instructions are always available separately. Saved prompts live in Settings.

Text output is editable. AI table results have editable cells and are copied as both tab-separated text and an HTML table; the destination decides which representation it accepts. Formatted text has a plain Markdown representation plus HTML for basic headings, lists, bold, and code. Rich formatting support varies by app.

**Automatic paste requires Accessibility permission.** Invoke the shortcut from the intended destination so SnapPaste can remember that application. The helper restores focus and sends Cmd+V. Success means the paste event was sent; arbitrary apps do not provide a universal confirmation that insertion succeeded. Copy + manual paste is always available. SnapPaste does not replace normal Cmd+V.

## Stack and layout

| Path                           | Purpose                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `src/main.ts`                  | Electron lifecycle, tray, shortcut, clipboard, screenshot capture, IPC   |
| `src/main/providers.ts`        | Jev decisions and OpenAI Responses API integration                       |
| `src/main/settings.ts`         | Settings and encrypted key storage                                       |
| `src/preload.ts`               | Narrow, isolated renderer bridge                                         |
| `src/renderer/`                | React interface and styles                                               |
| `src/shared/`                  | Action catalogue, types, output validation, safe paste formatting        |
| `native/SnapPasteHelper.swift` | Apple Vision OCR, focus restoration, paste events, example image         |
| `tests/core.test.ts`           | Table integrity, safe formatting, action selection, local classification |

React + TypeScript, Electron + Vite + Forge, and a Swift helper using AppKit, CoreGraphics, and Vision. API requests run in the main process, not the renderer. There is no separate backend for this bring-your-own-key prototype.

## Validation

```sh
npm run check       # TypeScript and core tests
npm run package     # Build an unsigned local .app in out/
npm run make        # Build an unsigned ZIP for local testing
```

Native binaries are built for the current Mac's architecture. Both arm64 and x64 distribution need appropriately built helper binaries; do not assume the current helper is universal.

## Current limits

- macOS only. The UI uses a floating Electron window rather than an extension to each app's native Paste menu.
- OCR, Jev classification, and GPT extraction can be wrong. Images provide visible context only. No repository access, web research, or inferred reproduction steps are supplied.
- The slower multi-pass “careful extraction” mode and multi-screenshot merging are not implemented yet.
- Screenshot history is not persisted. Temporary image files are kept in an app-specific temporary directory during processing and removed on ordinary exit; an abnormal process kill may leave temporary files.
- Cloud requests time out and can be canceled. Provider accounts, model access, credits, and network connectivity are required for live AI features.
- API integrations are implemented but need a live-key acceptance test. Automated tests do not claim real-provider accuracy.
- Signing/notarization, auto-update distribution, accounts, subscriptions, and hosted API billing are future release work. The current package is for local development, not a public signed release.

## Provider documentation

- [TypeSafe image input](https://docs.typesafe.ai/images)
- [TypeSafe System One API](https://docs.typesafe.ai/api/system-one)
- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
