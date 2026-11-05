import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ACTIONS, localAnalysis } from "./shared/actions";
import { clipboardPayload, validateResult } from "./shared/format";
import type {
  ActionId,
  Capture,
  PasteResult,
  SettingsUpdate,
  Analysis,
  HistoryItem,
  LocalExtraction,
} from "./shared/types";
import { getSettings, saveSettings, validateSettings } from "./main/settings";
import { analyzeCapture, generateOutput } from "./main/providers";
import { HistoryStore } from "./main/history";
import { CatalogueStore } from "./main/catalogue";
import { catalogueAnalysis } from "./shared/catalogue";
import { annotateLocalActions, localOutput } from "./main/local";
import { ResultCache } from "./main/result-cache";
import { NativePaste } from "./main/native-paste";
import { placeMenu, type Placement, type Rect } from "./shared/placement";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
const exec = promisify(execFile);
app.setName("SnapPaste");
// Development only: OPENAI_API_KEY / JEV_API_KEY from the project's git-ignored env file.
if (!app.isPackaged)
  try {
    process.loadEnvFile(path.join(app.getAppPath(), ".env"));
  } catch {
    /* No env file: keys come from Settings. */
  }
let window: BrowserWindow;
let tray: Tray;
let capture: Capture | null = null;
let destinationPid = 0;
let pasteBridge: NativePaste;
let destinationToken: number | undefined;
let quitting = false;
let controller: AbortController | null = null;
let tempDirectory = "";
let history: HistoryStore;
let watcher: ChildProcess | null = null;
let screenshotActive = false;
let catalogue: CatalogueStore;
let definitionTimer: NodeJS.Timeout;
let fileWatcher: FSWatcher | undefined;
const fileTimers = new Map<string, NodeJS.Timeout>();
const results = new ResultCache();
// Inline paste menu: a non-activating panel, so the destination app keeps focus.
let palette: BrowserWindow;
let paletteAnchor: Rect = { x: 0, y: 0, width: 1, height: 1 };
let palettePlacement: Placement | null = null;
const paletteSize = { width: 390, height: 340 };
let paletteBusy = false;
let paletteSession = 0;
let lastClipboardChange = -1;

// OCR text and Jev analysis per screenshot, persisted so older screenshots open instantly.
// `fingerprint` is set only for real Jev results; local fallbacks are recomputed (cheaply).
interface CacheEntry {
  fingerprint: string;
  analysis: Analysis | null;
  text: string;
  local?: LocalExtraction;
}
const analysisCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
const progressListeners = new Map<
  string,
  (update: { text?: string; analysis?: Analysis }) => void
>();
let cacheFile = "";
let cacheTimer: NodeJS.Timeout | undefined;
let backgroundChain: Promise<unknown> = Promise.resolve();
const helper = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "SnapPasteHelper")
    : path.join(app.getAppPath(), "native/bin/SnapPasteHelper");
async function native(command: string, ...args: string[]): Promise<any> {
  const { stdout } = await exec(helper(), [command, ...args], {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
function broadcast(channel: string, ...args: unknown[]) {
  for (const target of [window, palette])
    if (target && !target.isDestroyed())
      target.webContents.send(channel, ...args);
}
function notice(message: string) {
  window?.webContents.send("notice", message);
}
function notify(body: string) {
  if (Notification.isSupported())
    new Notification({ title: "SnapPaste", body, silent: true }).show();
  else notice(body);
}
function emit() {
  if (capture) broadcast("capture", capture);
}
async function rememberDestination() {
  try {
    const context = await pasteBridge.capture();
    if (
      context.pid &&
      context.pid !== process.pid &&
      context.token !== undefined
    ) {
      destinationPid = context.pid;
      destinationToken = context.token;
    }
  } catch {
    /* Copy remains available even when native app focus cannot be read. */
  }
}
function positionPanel(compact: boolean) {
  window.setAlwaysOnTop(compact, "floating");
  window.setVisibleOnAllWorkspaces(compact, { visibleOnFullScreen: compact });
  window.setSize(compact ? 480 : 1040, compact ? 720 : 760);
  window.webContents.send("window:mode", compact);
  const { x, y } = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  const [width, height] = window.getSize();
  window.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + Math.max(10, (workArea.height - height) / 2)),
  );
  showMain();
}
function showMain() {
  window.show();
  // With no Dock icon, the app must be brought forward explicitly.
  app.focus({ steal: true });
  window.focus();
}
async function showPanel(paste = false) {
  await rememberDestination();
  positionPanel(paste);
  if (paste) void smartPaste().catch((error) => notice(error.message));
}
function startJob(): AbortController {
  controller?.abort();
  controller = new AbortController();
  return controller;
}
function historyChanged() {
  broadcast("history:changed");
}
function fingerprint() {
  const s = getSettings();
  return `catalogue-v1:${catalogue.version}:${s.jevModel}:${s.cloudEnabled}:${s.hasJevKey}`;
}
function fallbackAnalysis() {
  return catalogueAnalysis(
    catalogue.data,
    "fallback.several-content-types-with-no-clear-primary-subject",
    catalogue.version,
    "local",
  );
}
async function loadAnalysisCache() {
  try {
    const entries = JSON.parse(await readFile(cacheFile, "utf8"));
    if (Array.isArray(entries))
      for (const [id, entry] of entries)
        if (typeof id === "string" && typeof entry?.text === "string")
          analysisCache.set(id, entry);
  } catch {
    /* No cache yet. */
  }
}
function remember(id: string, entry: CacheEntry) {
  analysisCache.delete(id);
  analysisCache.set(id, entry);
  while (analysisCache.size > 500)
    analysisCache.delete(analysisCache.keys().next().value!);
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    void writeFile(cacheFile, JSON.stringify([...analysisCache]), {
      mode: 0o600,
    }).catch(() => {});
  }, 500);
}
/**
 * OCR + Jev classification for one screenshot. Shared by background analysis (right
 * after capture) and paste-time selection, so a screenshot is never analysed twice.
 */
function analyzeItem(
  id: string,
  png: Buffer,
  meta: { name: string; width: number; height: number; bytes: number },
): Promise<CacheEntry> {
  const fp = fingerprint();
  const cached = analysisCache.get(id);
  if (cached?.analysis && cached.fingerprint === fp) {
    if (getSettings().boostMode) {
      prepareActions({
        id,
        ...meta,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        ocrText: cached.text,
        local: cached.local,
        analysis: cached.analysis,
        phase: "ready",
      });
    }
    return Promise.resolve(cached);
  }
  const key = `${id}:${fp}`;
  const running = inflight.get(key);
  if (running) return running;
  const work = (async () => {
    const imagePath = path.join(tempDirectory, `${id}-${randomUUID()}.png`);
    try {
      let text = cached?.text;
      let local = cached?.local;
      if (text === undefined || !local) {
        await writeFile(imagePath, png, { mode: 0o600 });
        const ocr = await native("ocr", imagePath);
        text = String(ocr.text ?? "");
        local = {
          text,
          values: Array.isArray(ocr.values) ? ocr.values : [],
          tables: [],
        };
        remember(id, { fingerprint: "", analysis: null, text, local });
      }
      text = text ?? "";
      // Structure and classification run independently after the first OCR result.
      const structure = (async () => {
        if (local?.tables.length) return local.tables;
        await writeFile(imagePath, png, { mode: 0o600 });
        try {
          return (await native("structure", imagePath)).tables ?? [];
        } catch {
          return [];
        }
      })();
      const definitions = { data: catalogue.data, version: catalogue.version };
      progressListeners.get(id)?.({ text });
      const subject: Capture = {
        id,
        name: meta.name,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        width: meta.width,
        height: meta.height,
        bytes: meta.bytes,
        ocrText: text,
        local,
        analysis: fallbackAnalysis(),
        phase: "classifying",
      };
      let analysis: Analysis;
      try {
        analysis = await analyzeCapture(
          subject,
          AbortSignal.timeout(30000),
          (progress) => progressListeners.get(id)?.({ analysis: progress }),
          definitions,
        );
      } catch (error) {
        console.error("[snappaste] Jev classification failed:", error);
        analysis = {
          ...fallbackAnalysis(),
          warning:
            error instanceof Error
              ? error.message
              : "Image classification failed. Showing local fallback.",
        };
      }
      local = { text, values: local?.values ?? [], tables: await structure };
      subject.local = local;
      subject.analysis = analysis;
      annotateLocalActions(subject);
      analysis = subject.analysis;
      const entry = {
        local,
        fingerprint: analysis.source === "jev" ? fp : "",
        analysis,
        text,
      };
      remember(id, entry);
      prepareActions(subject);
      return entry;
    } finally {
      inflight.delete(key);
      await rm(imagePath, { force: true }).catch(() => {});
    }
  })();
  inflight.set(key, work);
  return work;
}
/** Capture now, analyse right away in the background so the paste menu opens ready. */
function analyzeInBackground(item: HistoryItem, png: Buffer) {
  backgroundChain = backgroundChain
    .then(() => analyzeItem(item.id, png, item))
    .catch(() => {});
}
async function storeImage(
  image: Electron.NativeImage,
  name: string,
): Promise<HistoryItem> {
  if (image.isEmpty())
    throw new Error("That image could not be opened. Try a PNG or JPEG.");
  const { width, height } = image.getSize();
  if (width > 16000 || height > 16000 || width * height > 40_000_000)
    throw new Error(
      "That image is too large. Select a smaller screenshot region.",
    );
  const png = image.toPNG();
  if (png.length > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const scale = Math.min(1, 200 / width, 140 / height);
  const thumbnail = image
    .resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: "good",
    })
    .toPNG();
  const item = await history.add(png, thumbnail, { name, width, height });
  historyChanged();
  analyzeInBackground(item, png);
  return item;
}
async function clipboardImage(): Promise<Electron.NativeImage | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.find((t) =>
      ["image/png", "image/jpeg", "image/tiff"].includes(t),
    );
    if (!type) continue;
    const blob = await item.getType(type);
    if (!(blob instanceof Blob) || blob.size > 20 * 1024 * 1024)
      throw new Error(
        "The clipboard image is too large. Try a smaller screenshot.",
      );
    const image = nativeImage.createFromBuffer(
      Buffer.from(await blob.arrayBuffer()),
    );
    return image.isEmpty() ? null : image;
  }
  return null;
}
async function selectHistory(id: string) {
  const job = startJob();
  capture = null;
  broadcast("capture", null);
  const { item, image } = await history.get(id);
  if (job.signal.aborted) return;
  const cached = analysisCache.get(id);
  const next: Capture = {
    id,
    name: item.name,
    dataUrl: `data:image/png;base64,${image.toString("base64")}`,
    width: item.width,
    height: item.height,
    bytes: item.bytes,
    ocrText: cached?.text ?? "",
    local: cached?.local,
    analysis: {
      ...fallbackAnalysis(),
      actions: [ACTIONS.text],
      stage: "category",
    },
    phase: cached ? "classifying" : "reading",
  };
  capture = next;
  emit();
  const listener = (update: { text?: string; analysis?: Analysis }) => {
    if (job.signal.aborted || capture?.id !== id) return;
    if (update.text !== undefined) next.ocrText = update.text;
    if (update.analysis) next.analysis = update.analysis;
    next.phase = "classifying";
    emit();
  };
  progressListeners.set(id, listener);
  try {
    const entry = await analyzeItem(id, image, item);
    if (job.signal.aborted || capture?.id !== id) return;
    next.ocrText = entry.text;
    next.local = entry.local;
    next.analysis = entry.analysis ?? fallbackAnalysis();
  } catch (error) {
    if (job.signal.aborted) return;
    console.error("[snappaste] screenshot analysis failed:", error);
    next.analysis = {
      ...fallbackAnalysis(),
      warning:
        error instanceof Error
          ? error.message
          : "Image classification failed. Showing local fallback.",
    };
  } finally {
    if (progressListeners.get(id) === listener) progressListeners.delete(id);
  }
  if (!job.signal.aborted && capture?.id === id) {
    next.phase = "ready";
    updateOutputStatus(id);
  }
}
async function smartPaste(): Promise<Capture> {
  controller?.abort();
  capture = null;
  broadcast("capture", null);
  const image = await clipboardImage();
  const item = image
    ? await storeImage(image, "Clipboard screenshot")
    : (await history.list()).items[0];
  if (!item) {
    capture = null;
    broadcast("capture", null);
    throw new Error(
      "No screenshots yet. Capture with your screenshot shortcut, copy an image, or add an image to history.",
    );
  }
  await selectHistory(item.id);
  return capture!;
}
async function captureRegion(reopen = false): Promise<HistoryItem | null> {
  if (screenshotActive) throw new Error("Finish the current screenshot first.");
  screenshotActive = true;
  await rememberDestination();
  window.hide();
  const imagePath = path.join(tempDirectory, `screen-${randomUUID()}.png`);
  try {
    try {
      await exec("/usr/sbin/screencapture", ["-i", "-x", "-o", imagePath], {
        timeout: 120000,
      });
    } catch {
      if (systemPreferences.getMediaAccessStatus("screen") !== "granted")
        throw new Error(
          "Capture needs Screen Recording permission. Copy an existing screenshot or import an image instead.",
        );
      return null; // Escape cancels the native region selector.
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(imagePath);
    } catch {
      return null;
    }
    // Capture now, classify later. No OCR, Jev, or GPT call happens here.
    return await storeImage(
      nativeImage.createFromBuffer(bytes),
      `Screenshot · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    );
  } finally {
    screenshotActive = false;
    await rm(imagePath, { force: true });
    if (reopen) positionPanel(false);
  }
}
function configureWatcher() {
  watcher?.kill();
  watcher = null;
  if (!getSettings().watchClipboard) return;
  let checking = false;
  const child = spawn(helper(), ["watch-clipboard"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  watcher = child;
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", async (line) => {
    if (checking || quitting) return;
    try {
      if (!JSON.parse(line).imageChanged) return;
      checking = true;
      const image = await clipboardImage();
      if (image) await storeImage(image, "Clipboard screenshot");
    } catch {
      /* Never expose clipboard contents in logs or interrupt the user. */
    } finally {
      checking = false;
    }
  });
  child.on("error", () =>
    notice(
      "Clipboard image capture could not start. Your screenshot shortcut and manual import still work.",
    ),
  );
}
async function configureScreenshotFiles() {
  let folder = path.join(homedir(), "Desktop");
  try {
    const { stdout } = await exec("/usr/bin/defaults", [
      "read",
      "com.apple.screencapture",
      "location",
    ]);
    const configured = stdout.trim();
    if (configured)
      folder = configured.startsWith("~/")
        ? path.join(homedir(), configured.slice(2))
        : configured;
  } catch {
    /* macOS defaults to Desktop. */
  }
  try {
    fileWatcher = watch(folder, (_event, name) => {
      if (
        !name ||
        !/^(screenshot|screen shot).*\.(png|jpe?g)$/i.test(String(name))
      )
        return;
      const file = path.join(folder, String(name));
      clearTimeout(fileTimers.get(file));
      fileTimers.set(
        file,
        setTimeout(() => {
          fileTimers.delete(file);
          void (async () => {
            const info = await stat(file);
            if (info.size <= 0 || info.size > 20 * 1024 * 1024) return;
            await storeImage(
              nativeImage.createFromBuffer(await readFile(file)),
              path.basename(file),
            );
          })().catch(() => {});
        }, 700),
      );
    });
    fileWatcher.on("error", () => {
      notice(
        "Screenshot folder unavailable. The capture shortcut and copied images still work.",
      );
    });
  } catch {
    notice(
      "Screenshot folder unavailable. The capture shortcut and copied images still work.",
    );
  }
}
function registerShortcut(
  shortcut: string,
  kind: "paste" | "capture" = "paste",
): boolean {
  try {
    return globalShortcut.register(shortcut, () => {
      if (kind === "capture")
        void captureRegion().catch((error) => notice(error.message));
      else void openPalette().catch((error) => notify(error.message));
    });
  } catch {
    return false;
  }
}
function validatePasteResult(value: PasteResult): PasteResult {
  const result = validateResult(value);
  if (JSON.stringify(result).length > 2_000_000)
    throw new Error("This result is too large to paste.");
  return { ...value, ...result };
}
async function copyResult(input: PasteResult) {
  const { text, html } = clipboardPayload(validatePasteResult(input));
  await clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    }),
  ]);
}
function resultKey(subject: Capture, action: string, settings = getSettings()) {
  return `${subject.id}:${subject.analysis.catalogueVersion}:${action}:${settings.openaiModel}:${settings.cloudEnabled}:${settings.hasOpenAIKey}`;
}
function localOutputSafe(subject: Capture, action: string) {
  try {
    const option = subject.analysis.actions.find((a) => a.id === action);
    return option ? localOutput(subject, option) : null;
  } catch {
    return null;
  }
}
function preparedOutput(subject: Capture, action: string) {
  const key = resultKey(subject, action);
  const alreadyStarted = results.has(key) || results.isRunning(key);
  const output = results.get(key, () =>
    generateOutput(subject, action, "", AbortSignal.timeout(60000)),
  );
  if (!alreadyStarted) {
    const refresh = () => updateOutputStatus(subject.id);
    void output.then(refresh, refresh);
  }
  return output;
}
function updateOutputStatus(id: string) {
  if (capture?.id !== id || capture.phase !== "ready") return;
  const settings = getSettings();
  capture.preparedActions = [];
  capture.preparingActions = [];
  for (const action of capture.analysis.actions) {
    const key = resultKey(capture, action.id, settings);
    if (results.has(key)) capture.preparedActions.push(action.id);
    else if (results.isRunning(key)) capture.preparingActions.push(action.id);
  }
  emit();
}
function prepareActions(subject: Capture) {
  const settings = getSettings();
  const cloudAvailable = settings.cloudEnabled && settings.hasOpenAIKey;
  const actions = settings.boostMode
    ? subject.analysis.actions
    : subject.analysis.actions.slice(1, 2);
  for (const action of actions) {
    if (action.processor === "app_control" || action.id === "custom") continue;
    if (
      localOutputSafe(subject, action.id) ||
      (action.cloud && cloudAvailable)
    ) {
      // The cache shares in-progress work with clicks and permits retry on failure.
      void preparedOutput(subject, action.id).catch(() => {});
    }
  }
  updateOutputStatus(subject.id);
}
async function generateFor(
  id: string,
  action: ActionId,
  instruction = "",
): Promise<PasteResult> {
  if (!capture || capture.id !== id)
    throw new Error("The screenshot changed. Select the action again.");
  if (
    typeof instruction !== "string" ||
    !capture.analysis.actions.some((a) => a.id === action)
  )
    throw new Error("Choose one of the options for this screenshot.");
  const subject = capture;
  if (!instruction) return preparedOutput(subject, action);
  return generateOutput(
    subject,
    action,
    instruction,
    AbortSignal.timeout(60000),
  );
}
// MARK: Inline paste menu
function cursorAnchor(): Rect {
  const { x, y } = screen.getCursorScreenPoint();
  return { x, y, width: 1, height: 1 };
}
function placePalette(keepEdge = false) {
  const display = screen.getDisplayMatching({
    ...paletteAnchor,
    width: Math.max(1, paletteAnchor.width),
    height: Math.max(1, paletteAnchor.height),
  });
  let placed = placeMenu(paletteAnchor, paletteSize, display.workArea);
  // When the menu resizes in place, keep the edge next to the caret fixed.
  if (keepEdge && palettePlacement?.side === "above") {
    const bounds = palette.getBounds();
    placed = {
      ...palettePlacement,
      y: Math.max(
        display.workArea.y,
        bounds.y + bounds.height - paletteSize.height,
      ),
    };
  } else if (keepEdge && palettePlacement) placed = palettePlacement;
  palettePlacement = placed;
  palette.setBounds({ x: placed.x, y: placed.y, ...paletteSize });
}
function closePalette() {
  paletteSession++;
  if (paletteBusy) controller?.abort();
  paletteBusy = false;
  if (palette?.isVisible()) palette.hide();
}
async function openPalette() {
  if (palette.isVisible()) return closePalette();
  paletteSession++;
  let context: Record<string, any> = {};
  try {
    context = await pasteBridge.capture();
  } catch {
    /* Fall back to the mouse position and the last known destination. */
  }
  if (
    context.pid &&
    context.pid !== process.pid &&
    context.token !== undefined
  ) {
    destinationPid = context.pid;
    destinationToken = context.token;
  }
  // A newly copied screenshot (e.g. Ctrl+Cmd+Shift+4) becomes the latest item.
  if (
    context.clipboardImage &&
    context.clipboardChange !== lastClipboardChange
  ) {
    lastClipboardChange = context.clipboardChange;
    try {
      const image = await clipboardImage();
      if (image) await storeImage(image, "Clipboard screenshot");
    } catch {
      /* Fall through to existing history. */
    }
  }
  // After a mouse-click paste SnapPaste is hidden; a hidden app cannot show the menu.
  if (app.isHidden())
    await native("unhide", String(process.pid)).catch(() => {});
  const page = await history.list();
  paletteAnchor = context.anchor ?? cursorAnchor();
  paletteSize.height = 340;
  palettePlacement = null;
  placePalette();
  palette.webContents.send("palette:open", {
    items: page.items.slice(0, 30).map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: item.createdAt,
      thumbnail: item.thumbnail,
    })),
    app: typeof context.app === "string" ? context.app : "",
    trusted: context.trusted !== false,
  });
  palette.showInactive();
  palette.focus();
  if (page.items[0]) void selectHistory(page.items[0].id);
}
/**
 * A mouse click on the menu activates SnapPaste (asynchronously, sometimes after the
 * result is already ready), and macOS ignores a background helper's request to switch
 * back. While SnapPaste is frontmost, hide it so macOS returns focus to the app the
 * user was typing in, then let the helper paste there.
 */
async function returnFocus() {
  for (let attempt = 0; attempt < 12; attempt++) {
    let front = 0;
    try {
      front = (await native("frontmost")).pid;
    } catch {
      return;
    }
    if (front !== process.pid) return;
    app.hide();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function pasteInto(
  payload: { text: string; html: string },
  token = destinationToken,
) {
  const copied = async () => {
    await clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
        "text/html": new Blob([payload.html], { type: "text/html" }),
      }),
    ]);
  };
  try {
    if (token === undefined) {
      await copied();
      notify(
        "Click inside the destination text field, then press your smart-paste shortcut. Result copied for now.",
      );
      return "copied";
    }
    const outcome = await pasteBridge.paste(token, payload);
    if (outcome.ok) return "pasted";
    // A stale target is never allowed to paste into a newly opened menu's field.
    await copied();
    notify(
      outcome.reason === "untrusted"
        ? "Automatic paste needs Accessibility for this SnapPaste build. Open SnapPaste Settings → macOS permissions. Result copied for now."
        : [
              "field-unavailable",
              "selection-unavailable",
              "destination-closed",
            ].includes(outcome.reason)
          ? "The original text field is no longer available. Result copied; click the field and press ⌘V."
          : "The destination changed. Result copied; press ⌘V where you want it.",
    );
    return "copied";
  } catch {
    await copied();
    notify(
      "Could not restore the destination. Result copied; press ⌘V to paste.",
    );
    return "copied";
  }
}
function createPalette() {
  palette = new BrowserWindow({
    type: "panel",
    width: paletteSize.width,
    height: paletteSize.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    alwaysOnTop: true,
    vibrancy: "popover",
    visualEffectState: "active",
    roundedCorners: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  palette.setAlwaysOnTop(true, "pop-up-menu");
  palette.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  palette.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  palette.webContents.on("will-navigate", (event) => event.preventDefault());
  palette.on("blur", () => {
    if (!paletteBusy) closePalette();
  });
  return MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? palette.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#palette`)
    : palette.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        { hash: "palette" },
      );
}
function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    const trusted = [window, palette].some(
      (w) =>
        w &&
        event.sender === w.webContents &&
        event.senderFrame === w.webContents.mainFrame,
    );
    if (!trusted) throw new Error("Untrusted request.");
    return fn(...args);
  });
}
function setupIPC() {
  handle("settings:get", getSettings);
  handle("catalogue:status", () => catalogue.status());
  handle("settings:save", async (update: SettingsUpdate) => {
    validateSettings(update);
    const previous = getSettings();
    globalShortcut.unregister(previous.shortcut);
    globalShortcut.unregister(previous.captureShortcut);
    if (
      !registerShortcut(update.shortcut) ||
      !registerShortcut(update.captureShortcut, "capture")
    ) {
      globalShortcut.unregister(update.shortcut);
      globalShortcut.unregister(update.captureShortcut);
      registerShortcut(previous.shortcut);
      registerShortcut(previous.captureShortcut, "capture");
      throw new Error(
        "A shortcut is unavailable. Choose two different, unused shortcuts.",
      );
    }
    try {
      const result = saveSettings(update);
      analysisCache.clear();
      results.clear();
      if (capture) updateOutputStatus(capture.id);
      configureWatcher();
      await history.setLimit(result.historyLimitMB * 1024 * 1024);
      historyChanged();
      updateTray();
      return result;
    } catch (error) {
      globalShortcut.unregister(update.shortcut);
      globalShortcut.unregister(update.captureShortcut);
      registerShortcut(previous.shortcut);
      registerShortcut(previous.captureShortcut, "capture");
      throw error;
    }
  });
  handle("history:list", (offset = 0) => {
    if (!Number.isInteger(offset) || offset < 0)
      throw new Error("Invalid history offset.");
    return history.list(offset);
  });
  handle("history:select", async (id: string) => {
    await rememberDestination();
    positionPanel(true);
    await selectHistory(id);
  });
  handle("capture:get", () => capture);
  handle("capture:clipboard", smartPaste);
  handle("capture:import", async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: "Add screenshots to history",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (picked.canceled) return null;
    let last: HistoryItem | null = null;
    for (const file of picked.filePaths) {
      if ((await stat(file)).size > 20 * 1024 * 1024) {
        notice(`${path.basename(file)} exceeds 20 MB and was skipped.`);
        continue;
      }
      last = await storeImage(
        nativeImage.createFromBuffer(await readFile(file)),
        path.basename(file),
      );
    }
    return last;
  });
  handle("capture:screen", () => captureRegion(true));
  handle("capture:example", async (kind: string = "table") => {
    if (!["table", "code"].includes(kind)) throw new Error("Unknown example.");
    const imagePath = path.join(tempDirectory, `example-${kind}.png`);
    await native("fixture", imagePath, kind);
    return storeImage(
      nativeImage.createFromBuffer(await readFile(imagePath)),
      kind === "code" ? "Example · pull request" : "Example · pricing table",
    );
  });
  handle("capture:analyze", async () => {
    if (!capture) throw new Error("Choose a screenshot first.");
    analysisCache.delete(capture.id);
    await selectHistory(capture.id);
    return capture;
  });
  handle("result:generate", generateFor);
  handle("palette:select", (id: string) => {
    if (typeof id !== "string") throw new Error("Invalid screenshot.");
    paletteSession++;
    return selectHistory(id);
  });
  handle("palette:run", async (id: string, action: ActionId) => {
    if (
      !capture ||
      capture.id !== id ||
      !capture.analysis.actions.some((a) => a.id === action)
    )
      throw new Error("Choose an option for the current screenshot.");
    const session = paletteSession;
    const target = destinationToken;
    paletteBusy = true;
    try {
      if (action === "original") {
        await clipboard.write([
          new ClipboardItem({
            "image/png": new Blob(
              [
                new Uint8Array(
                  Buffer.from(capture.dataUrl.split(",")[1], "base64"),
                ),
              ],
              { type: "image/png" },
            ),
          }),
        ]);
        palette.hide();
        notify("Original image copied. Press ⌘V to paste it.");
        return "copied";
      }
      if (action === "select_region")
        throw new Error("Select a region from the screenshot preview.");
      const result = await generateFor(id, action);
      if (
        !palette.isVisible() ||
        session !== paletteSession ||
        capture?.id !== id
      )
        return "cancelled";
      if (result.values?.length || action === "review_text") return { result };
      const payload = clipboardPayload(validatePasteResult(result));
      paletteBusy = false;
      palette.hide();
      await returnFocus();
      return await pasteInto(payload, target);
    } finally {
      paletteBusy = false;
    }
  });
  handle("palette:paste", async (result: PasteResult) => {
    const payload = clipboardPayload(validatePasteResult(result));
    const target = destinationToken;
    paletteBusy = false;
    palette.hide();
    await returnFocus();
    return pasteInto(payload, target);
  });
  handle(
    "capture:crop",
    async (
      id: string,
      region: { x: number; y: number; width: number; height: number },
    ) => {
      if (
        !capture ||
        capture.id !== id ||
        !region ||
        !Object.values(region).every(Number.isFinite) ||
        region.x < 0 ||
        region.y < 0 ||
        region.width <= 0 ||
        region.height <= 0 ||
        region.x + region.width > 1.001 ||
        region.y + region.height > 1.001
      )
        throw new Error("Select a valid screenshot region.");
      const image = nativeImage.createFromDataURL(capture.dataUrl);
      const size = image.getSize();
      const cropped = image.crop({
        x: Math.floor(region.x * size.width),
        y: Math.floor(region.y * size.height),
        width: Math.max(1, Math.floor(region.width * size.width)),
        height: Math.max(1, Math.floor(region.height * size.height)),
      });
      const item = await storeImage(cropped, "Selected region");
      await selectHistory(item.id);
      broadcast("palette:cropped", item);
    },
  );
  handle("palette:close", closePalette);
  handle("palette:resize", (height: number) => {
    if (!Number.isFinite(height)) return;
    paletteSize.height = Math.round(Math.min(Math.max(height, 56), 520));
    placePalette(true);
  });
  handle("palette:library", () => {
    closePalette();
    positionPanel(false);
  });
  handle("result:copy", copyResult);
  handle("result:paste", async (result: PasteResult) => {
    const payload = clipboardPayload(validatePasteResult(result));
    const target = destinationToken;
    window.hide();
    await returnFocus();
    return pasteInto(payload, target);
  });
  handle("job:cancel", () => {
    controller?.abort();
  });
  handle("window:hide", () => window.hide());
  handle("window:expand", () => positionPanel(false));
  handle("permissions:get", async () => ({
    accessibility: !!(await pasteBridge.request("status")).trusted,
    screen: systemPreferences.getMediaAccessStatus("screen"),
  }));
  handle("permissions:open", async (kind: string) => {
    if (!["screen", "accessibility"].includes(kind))
      throw new Error("Unknown permission.");
    await shell.openExternal(
      `x-apple.systempreferences:com.apple.preference.security?${kind === "screen" ? "Privacy_ScreenCapture" : "Privacy_Accessibility"}`,
    );
  });
}
function trayIcon() {
  const size = 36,
    pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const border =
        x >= 8 &&
        x <= 27 &&
        y >= 9 &&
        y <= 29 &&
        (x <= 10 || x >= 25 || y <= 11 || y >= 27);
      const top = x >= 14 && x <= 22 && y >= 5 && y <= 12;
      const line = x >= 14 && x <= 21 && (y === 18 || y === 23);
      if (border || top || line) pixels[(y * size + x) * 4 + 3] = 255;
    }
  const icon = nativeImage.createFromBitmap(pixels, {
    width: size,
    height: size,
    scaleFactor: 2,
  });
  icon.setTemplateImage(true);
  return icon;
}
function updateTray() {
  const settings = getSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Smart paste",
        accelerator: settings.shortcut,
        click: () => {
          void openPalette().catch((error) => notify(error.message));
        },
      },
      {
        label: "Capture screenshot",
        accelerator: settings.captureShortcut,
        click: () => {
          void captureRegion().catch((error) => notice(error.message));
        },
      },
      {
        label: "Screenshot history",
        click: () => {
          void showPanel();
        },
      },
      {
        label: "Settings…",
        click: () => {
          void showPanel().then(() => window.webContents.send("settings:open"));
        },
      },
      { type: "separator" },
      {
        label: "Quit SnapPaste",
        accelerator: "Command+Q",
        click: () => app.quit(),
      },
    ]),
  );
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) void showPanel();
  });
  void app.whenReady().then(async () => {
    if (process.platform !== "darwin") {
      dialog.showErrorBox(
        "macOS required",
        "SnapPaste currently supports macOS.",
      );
      app.quit();
      return;
    }
    pasteBridge = new NativePaste(path.dirname(helper()), process.pid);
    catalogue = new CatalogueStore(
      path.join(app.getPath("userData"), "cache", "definitions.json"),
    );
    await catalogue.open();
    void catalogue.refresh();
    definitionTimer = setInterval(
      () => {
        void catalogue.refresh();
      },
      6 * 60 * 60 * 1000,
    );
    history = new HistoryStore(
      path.join(app.getPath("userData"), "screenshots"),
      getSettings().historyLimitMB * 1024 * 1024,
    );
    await history.open();
    tempDirectory = await mkdtemp(path.join(tmpdir(), "snappaste-"));
    cacheFile = path.join(app.getPath("userData"), "analysis-cache.json");
    await loadAnalysisCache();
    // Menu-bar utility: no Dock icon, so the paste menu never pulls SnapPaste forward.
    app.dock?.hide();
    void native("context")
      .then((c) => (lastClipboardChange = c.clipboardChange))
      .catch(() => {});
    window = new BrowserWindow({
      width: 1040,
      height: 760,
      minWidth: 420,
      minHeight: 600,
      title: "SnapPaste",
      titleBarStyle: "hiddenInset",
      backgroundColor: "#f7f8fa",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    setupIPC();
    void createPalette();
    const settings = getSettings();
    const shortcutOk =
      registerShortcut(settings.shortcut) &&
      registerShortcut(settings.captureShortcut, "capture");
    tray = new Tray(trayIcon());
    tray.setToolTip("SnapPaste — capture what you see, paste what you need.");
    updateTray();
    configureWatcher();
    void configureScreenshotFiles();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "SnapPaste",
          submenu: [
            { role: "about" },
            { type: "separator" },
            {
              label: "Smart paste",
              click: () => {
                void openPalette().catch((error) => notify(error.message));
              },
            },
            {
              label: "Capture screenshot",
              click: () => {
                void captureRegion().catch((error) => notice(error.message));
              },
            },
            {
              label: "Settings…",
              accelerator: "Command+,",
              click: () => window.webContents.send("settings:open"),
            },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { role: "resetZoom" },
          ],
        },
      ]),
    );
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
      await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    else
      await window.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      );
    showMain();
    if (!shortcutOk)
      notice(
        "The smart-paste shortcut is already in use. Choose another in Settings.",
      );
    app.on("activate", () => {
      if (!window.isVisible()) void showPanel();
    });
  });
}
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  controller?.abort();
  globalShortcut.unregisterAll();
  watcher?.kill();
  pasteBridge?.close();
  fileWatcher?.close();
  clearInterval(definitionTimer);
  for (const timer of fileTimers.values()) clearTimeout(timer);
  const cleanup = tempDirectory
    ? rm(tempDirectory, { recursive: true, force: true })
    : Promise.resolve();
  void cleanup.catch(() => {}).finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  /* Keep the menu-bar utility running. */
});
