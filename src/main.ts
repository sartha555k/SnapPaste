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
  screen,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
} from "./shared/types";
import { getSettings, saveSettings, validateSettings } from "./main/settings";
import { analyzeCapture, generateOutput } from "./main/providers";
import { HistoryStore } from "./main/history";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
const exec = promisify(execFile);
app.setName("SnapPaste");
let window: BrowserWindow;
let tray: Tray;
let capture: Capture | null = null;
let destinationPid = 0;
let quitting = false;
let controller: AbortController | null = null;
let tempDirectory = "";
let history: HistoryStore;
let watcher: ChildProcess | null = null;
let screenshotActive = false;
const analysisCache = new Map<
  string,
  { fingerprint: string; analysis: Analysis; text: string }
>();
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
function notice(message: string) {
  window?.webContents.send("notice", message);
}
function emit() {
  if (capture) window?.webContents.send("capture", capture);
}
async function rememberDestination() {
  try {
    const { pid } = await native("frontmost");
    if (pid && pid !== process.pid) destinationPid = pid;
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
  window.show();
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
  window?.webContents.send("history:changed");
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
  window.webContents.send("capture", null);
  const { item, image } = await history.get(id);
  if (job.signal.aborted) return;
  const settings = getSettings();
  const fingerprint = `hierarchy-v2:${settings.jevModel}:${settings.cloudEnabled}:${settings.hasJevKey}`;
  const cached = analysisCache.get(id);
  const next: Capture = {
    id,
    name: item.name,
    dataUrl: `data:image/png;base64,${image.toString("base64")}`,
    width: item.width,
    height: item.height,
    bytes: item.bytes,
    ocrText: cached?.text ?? "",
    analysis: {
      ...localAnalysis(""),
      actions: [ACTIONS.text],
      stage: "category",
    },
    phase: "reading",
  };
  capture = next;
  emit();
  if (cached && cached.fingerprint === fingerprint) {
    next.analysis = cached.analysis;
    next.phase = "ready";
    emit();
    return;
  }
  const imagePath = path.join(tempDirectory, `${id}-${randomUUID()}.png`);
  try {
    await writeFile(imagePath, image, { mode: 0o600 });
    const ocr = cached ? { text: cached.text } : await native("ocr", imagePath);
    if (job.signal.aborted || capture?.id !== id) return;
    next.ocrText = ocr.text;
    next.phase = "classifying";
    emit();
    next.analysis = await analyzeCapture(
      next,
      AbortSignal.any([job.signal, AbortSignal.timeout(30000)]),
      (progress) => {
        if (!job.signal.aborted && capture?.id === id) {
          next.analysis = progress;
          emit();
        }
      },
    );
    if (!job.signal.aborted && next.analysis.source === "jev")
      analysisCache.set(id, {
        fingerprint,
        analysis: next.analysis,
        text: next.ocrText,
      });
    while (analysisCache.size > 100)
      analysisCache.delete(analysisCache.keys().next().value!);
  } catch (error) {
    if (job.signal.aborted) return;
    next.analysis = {
      ...localAnalysis(next.ocrText),
      warning:
        error instanceof Error
          ? error.message
          : "Image classification failed. Showing local fallback.",
    };
  } finally {
    await rm(imagePath, { force: true }).catch(() => {});
  }
  if (!job.signal.aborted && capture?.id === id) {
    next.phase = "ready";
    emit();
  }
}
async function smartPaste(): Promise<Capture> {
  controller?.abort();
  capture = null;
  window.webContents.send("capture", null);
  const image = await clipboardImage();
  const item = image
    ? await storeImage(image, "Clipboard screenshot")
    : (await history.list()).items[0];
  if (!item) {
    capture = null;
    window.webContents.send("capture", null);
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
function registerShortcut(
  shortcut: string,
  kind: "paste" | "capture" = "paste",
): boolean {
  try {
    return globalShortcut.register(shortcut, () => {
      if (kind === "capture")
        void captureRegion().catch((error) => notice(error.message));
      else void showPanel(true);
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
function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted request.");
    return fn(...args);
  });
}
function setupIPC() {
  handle("settings:get", getSettings);
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
  handle(
    "result:generate",
    async (id: string, action: ActionId, instruction = "") => {
      if (!capture || capture.id !== id)
        throw new Error("The screenshot changed. Select the action again.");
      if (!Object.hasOwn(ACTIONS, action) || typeof instruction !== "string")
        throw new Error("Invalid paste action.");
      if (
        action !== "text" &&
        action !== "custom" &&
        !capture.analysis.actions.some((a) => a.id === action)
      )
        throw new Error(
          "Choose one of the actions selected for this screenshot.",
        );
      if (action === "text")
        return generateOutput(
          capture,
          action,
          instruction,
          new AbortController().signal,
        );
      const job = startJob();
      try {
        return await generateOutput(
          capture,
          action,
          instruction,
          AbortSignal.any([job.signal, AbortSignal.timeout(60000)]),
        );
      } catch (error) {
        if (job.signal.aborted) throw new Error("Cancelled.");
        throw error;
      }
    },
  );
  handle("result:copy", copyResult);
  handle("result:paste", async (result: PasteResult) => {
    if (!destinationPid)
      throw new Error(
        "Open your destination app and invoke SnapPaste with the shortcut, or use Copy and paste manually.",
      );
    if (!systemPreferences.isTrustedAccessibilityClient(false))
      throw new Error(
        "Automatic paste needs Accessibility permission for SnapPaste. Open Settings, or use Copy.",
      );
    await copyResult(result);
    window.hide();
    try {
      await native("paste", String(destinationPid));
    } catch {
      window.show();
      throw new Error(
        "Could not paste into the destination. The result is on your clipboard; paste it manually.",
      );
    }
  });
  handle("job:cancel", () => {
    controller?.abort();
  });
  handle("window:hide", () => window.hide());
  handle("window:expand", () => positionPanel(false));
  handle("permissions:get", () => ({
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
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
          void showPanel(true);
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
    history = new HistoryStore(
      path.join(app.getPath("userData"), "screenshots"),
      getSettings().historyLimitMB * 1024 * 1024,
    );
    await history.open();
    tempDirectory = await mkdtemp(path.join(tmpdir(), "snappaste-"));
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
    const settings = getSettings();
    const shortcutOk =
      registerShortcut(settings.shortcut) &&
      registerShortcut(settings.captureShortcut, "capture");
    tray = new Tray(trayIcon());
    tray.setToolTip("SnapPaste — capture what you see, paste what you need.");
    updateTray();
    configureWatcher();
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
                void showPanel(true);
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
    window.show();
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
  const cleanup = tempDirectory
    ? rm(tempDirectory, { recursive: true, force: true })
    : Promise.resolve();
  void cleanup.catch(() => {}).finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  /* Keep the menu-bar utility running. */
});
