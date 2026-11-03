# SnapPaste

**Capture now. Decide at paste.**

A macOS menu-bar app that keeps screenshot history and turns the selected screenshot into something useful when you paste. The menu has exactly four choices: local text first, then three actions chosen for the image by Jev. OpenAI generates only the transformation you select.

## Run locally

Requirements: macOS, Node.js 22.12+ (Node 24 recommended), npm, and Apple’s Command Line Tools (`xcode-select --install`). No Apple Developer membership is needed for development.

```sh
npm ci
npm start
```

Closing the window leaves SnapPaste running in the menu bar. Quit using its menu or Cmd+Q.

## The workflow

1. **Capture several screenshots:** press **Command+Option+S** to capture a region directly into local history. Repeat as often as needed. You can also import several PNG/JPEG files at once.
2. **Go to your destination app:** focus the message, document, or spreadsheet where you want the content.
3. **Press Command+Option+V:** a compact paste menu opens. A clipboard image is saved and selected if one is present; otherwise the most recent saved screenshot is selected. Click the screenshot at the top to choose an older one.
4. **Choose from four options:** the first is always **Just the text**, using Apple Vision on this Mac. The other three come from a category-specific action pool ranked by Jev.
5. **Review and paste:** selecting an AI action sends that action’s prompt and the image to OpenAI. Edit the result, then copy or paste into the previous app.

Both global shortcuts are configurable in **Settings**. Normal Cmd+V continues working. The shortcut opens SnapPaste’s own floating menu; this is not an extension of another app’s native paste menu.

### Multiple screenshots and storage

History persists across restarts. It has no screenshot-count limit; storage is bounded by a configurable **50–2,000 MB** budget (default **200 MB**). Identical images are deduplicated. The oldest app-owned history images expire when the budget fills. Original imported files are never deleted. A single image must be at most 20 MB and 40 megapixels.

Optionally enable **Save copied screenshots automatically** in Settings. While SnapPaste runs, a native clipboard watcher saves new copied images locally. Use Control+Command+Shift+4 for screenshots copied by macOS. Images saved only to Desktop are not monitored; use SnapPaste’s capture shortcut or import them. Automatic clipboard collection is off by default.

Saving an image triggers **no OCR or cloud request**. OCR and classification happen when an image is selected at paste time. Successful classifications are cached in memory for reuse during that session. The full history does not get uploaded.

### Jev’s two-stage classification

There are eight content categories plus a general-image fallback:

| Category             | Examples of eligible actions                                                      |
| -------------------- | --------------------------------------------------------------------------------- |
| Tables & data        | Spreadsheet cells, formatted table, JSON rows, comparison, sharing message        |
| Code & development   | Copy code, explain code, bug report, PR summary, review comment, teammate message |
| Receipts & invoices  | Expense fields, itemized rows, readable summary, invoice message                  |
| Events & schedules   | Event details, invitation, agenda table, attendance checklist                     |
| Documents & articles | Clean formatting, summary, outline, English translation, email                    |
| Conversations        | Reply, decisions, action items, handoff, summary                                  |
| Charts & analytics   | Visible values, chart summary, caption, report notes                              |
| Interfaces & visuals | Screen description, design feedback, UI handoff, alt text                         |

**Request 1** asks Jev to choose the main category from the image and local OCR. **Request 2** contains only that category’s candidate actions and asks Jev to score their usefulness. The three highest-ranked actions join local text in the menu. A PR and a plain code error can therefore receive different actions within the same category.

The second request depends on the first; they are not parallel independent classifications. There is no fixed “formatted” second slot. Jev makes decisions; OpenAI writes the chosen output. Unknown or mixed images have general candidate actions. Classification can be wrong—review the source and result.

### API setup

Supply your own keys in Settings and enable cloud processing. Keys are encrypted with Electron `safeStorage` through macOS secure storage, stay out of the renderer after saving, and are never included in the repository or packaged app.

- **Jev / TypeSafe:** image classification and action rankings. Default `jev-1.14.0`, with experimental image support enabled in provider requests.
- **OpenAI:** selected transformations via the Responses API and strict structured output. Default `gpt-4.1-mini`; configure a compatible image + Structured Outputs model available to your account.
- **Local text:** Apple Vision OCR. No API key, network, or model-generation call needed. With cloud enabled, opening the menu can independently start Jev classification while local text is available.

If Jev is disabled, unavailable, or returns invalid decisions, the UI explicitly labels suggestions **LOCAL FALLBACK**. These are simple OCR rules, not claimed model understanding. Without OpenAI, local text still works; AI actions explain which configuration is missing. There are no fake AI responses.

Settings changes invalidate the classification cache. Only the next screenshot you choose is analyzed using the new configuration. Saved custom prompts are available in Settings and from the paste menu.

### Try it without private data

Click **Try a table** and **Try a pull request** in screenshot history. These create clearly labeled sample images locally and store both. Click either screenshot to open its paste menu. Without keys, local text is real Apple Vision OCR; with keys enabled, Jev and OpenAI calls are real provider requests and use your credits.

### Results and permissions

Text is editable. Tables have editable cells and copy as tab-separated text plus an HTML table. Basic Markdown formatting also supplies HTML for rich paste; support depends on the destination app. Source text is escaped and spreadsheet cells are protected against formula injection.

**Capture region** needs Screen Recording permission for the app macOS identifies (Electron during development, SnapPaste when packaged). Automatic paste needs **Accessibility** permission. Import, local OCR, and copy do not need those permissions. A permission change may require restarting the app.

Invoke the shortcut from your destination app so SnapPaste remembers it. Paste restores that application and sends Cmd+V. This confirms sending the event, not insertion into arbitrary third-party apps. Copy and manual paste are always available.

## Stack and layout

Electron + React + TypeScript, Vite/Forge, and a Swift helper using AppKit, CoreGraphics, and Apple Vision. Provider requests run in the main process. This bring-your-own-key prototype has no hosted backend.

| Path                           | Purpose                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `src/main.ts`                  | Lifecycle, tray, shortcuts, history integration, capture, clipboard, IPC      |
| `src/main/history.ts`          | Persistent local image history, deduplication, pagination, disk quota         |
| `src/main/decisions.ts`        | Sequential category → category-scoped action ranking                          |
| `src/main/providers.ts`        | Jev image transport and selected OpenAI transformation                        |
| `src/main/settings.ts`         | Settings and encrypted keys                                                   |
| `src/shared/actions.ts`        | Category taxonomy and action-specific prompts                                 |
| `src/shared/format.ts`         | Result validation and safe clipboard representations                          |
| `src/preload.ts`               | Isolated, limited renderer bridge                                             |
| `src/renderer/`                | Screenshot library, compact paste menu, result editor, settings               |
| `native/SnapPasteHelper.swift` | OCR, clipboard change watcher, focus restoration, paste, samples              |
| `tests/`                       | Classification sequencing/scoping, history durability/quota, output integrity |

## Validate and package

```sh
npm run check
npm run package  # unsigned local .app in out/
npm run make     # unsigned ZIP for local testing
```

The native helper builds for the current Mac’s architecture. Build separately for Intel and Apple Silicon; the helper is not universal. Signing/notarization and automatic updates remain release work.

Current limits: macOS only; a single selected screenshot per transformation; no multi-image merging or deep-research mode. Small or cropped text can be lost in OCR or Jev’s resized image. Models see visible content, not your repository, unseen thread history, or destination app context. Requests time out and can be canceled. Real AI features require provider access, credits, and connectivity. Automated tests verify workflow behavior rather than model accuracy.

## Provider references

- [TypeSafe image input](https://docs.typesafe.ai/images)
- [TypeSafe System One API](https://docs.typesafe.ai/api/system-one)
- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
