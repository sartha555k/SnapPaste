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
import { execFile } from "node:child_process";
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
} from "./shared/types";
import { getSettings, saveSettings, validateSettings } from "./main/settings";
import { analyzeCapture, generateOutput } from "./main/providers";

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
let lastImagePath = "";
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
async function showPanel(readImage = false) {
  await rememberDestination();
  const compact = readImage;
  window.setSize(compact ? 460 : 1040, compact ? 680 : 760);
  window.webContents.send("window:mode", compact);
  const { x, y } = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  const [width, height] = window.getSize();
  window.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + Math.max(20, (workArea.height - height) / 2)),
  );
  window.show();
  window.focus();
  if (readImage) void readClipboard().catch((error) => notice(error.message));
}
function startJob(): AbortController {
  controller?.abort();
  controller = new AbortController();
  return controller;
}
async function prepareImage(
  image: Electron.NativeImage,
  name: string,
): Promise<Capture> {
  if (image.isEmpty())
    throw new Error("That image could not be opened. Try a PNG or JPEG.");
  const size = image.getSize();
  if (
    size.width > 16000 ||
    size.height > 16000 ||
    size.width * size.height > 40_000_000
  )
    throw new Error(
      "That image is too large. Select a smaller screenshot region.",
    );
  const job = startJob();
  const png = image.toPNG();
  const next: Capture = {
    id: randomUUID(),
    name,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width: size.width,
    height: size.height,
    bytes: png.length,
    ocrText: "",
    analysis: localAnalysis(""),
    phase: "reading",
  };
  capture = next;
  emit();
  const imagePath = path.join(tempDirectory, `${next.id}.png`);
  await writeFile(imagePath, png, { mode: 0o600 });
  const previousPath = lastImagePath;
  lastImagePath = imagePath;
  if (previousPath) await rm(previousPath, { force: true }).catch(() => {});
  try {
    const ocr = await native("ocr", imagePath);
    if (job.signal.aborted || capture?.id !== next.id) return next;
    next.ocrText = ocr.text;
    next.analysis = localAnalysis(ocr.text);
    next.phase = "ready";
    emit();
    next.analysis = await analyzeCapture(
      next,
      AbortSignal.any([job.signal, AbortSignal.timeout(20000)]),
    );
  } catch (error) {
    if (job.signal.aborted) return next;
    next.analysis.warning =
      error instanceof Error ? error.message : "Could not read this image.";
  }
  if (capture?.id === next.id) {
    next.phase = "ready";
    emit();
  }
  return next;
}
async function readClipboard(): Promise<Capture> {
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) =>
      ["image/png", "image/jpeg", "image/tiff"].includes(t),
    );
    if (type) {
      const blob = await item.getType(type);
      if (!(blob instanceof Blob) || blob.size > 20 * 1024 * 1024)
        throw new Error(
          "The clipboard image is too large. Try a smaller screenshot.",
        );
      return prepareImage(
        nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())),
        "Clipboard image",
      );
    }
  }
  controller?.abort();
  capture = null;
  window.webContents.send("capture", null);
  throw new Error(
    "No image on the clipboard. Copy an image, or press Control + Command + Shift + 4 to capture a region.",
  );
}
function registerShortcut(shortcut: string): boolean {
  try {
    return globalShortcut.register(shortcut, () => {
      void showPanel(true);
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
  handle("settings:save", (update: SettingsUpdate) => {
    validateSettings(update);
    const old = getSettings().shortcut;
    if (old !== update.shortcut && !registerShortcut(update.shortcut))
      throw new Error(
        "That shortcut is unavailable. Choose another combination.",
      );
    try {
      const result = saveSettings(update);
      if (old !== update.shortcut) globalShortcut.unregister(old);
      return result;
    } catch (error) {
      if (old !== update.shortcut) globalShortcut.unregister(update.shortcut);
      throw error;
    }
  });
  handle("capture:get", () => capture);
  handle("capture:clipboard", readClipboard);
  handle("capture:import", async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: "Choose a screenshot or image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    if ((await stat(filePath)).size > 20 * 1024 * 1024)
      throw new Error("Choose an image smaller than 20 MB.");
    return prepareImage(
      nativeImage.createFromBuffer(await readFile(filePath)),
      path.basename(filePath),
    );
  });
  handle("capture:screen", async () => {
    await rememberDestination();
    window.hide();
    const imagePath = path.join(tempDirectory, `screen-${randomUUID()}.png`);
    try {
      await exec("/usr/sbin/screencapture", ["-i", "-x", "-o", imagePath], {
        timeout: 120000,
      });
      let bytes: Buffer;
      try {
        bytes = await readFile(imagePath);
      } catch {
        return null;
      }
      return await prepareImage(
        nativeImage.createFromBuffer(bytes),
        "Screen capture",
      );
    } catch {
      if (systemPreferences.getMediaAccessStatus("screen") !== "granted")
        throw new Error(
          "Screen capture needs Screen Recording permission. You can also copy a screenshot or import an image.",
        );
      return null;
    } finally {
      await rm(imagePath, { force: true });
      window.show();
      window.focus();
    }
  });
  handle("capture:example", async () => {
    const imagePath = path.join(tempDirectory, "example-table.png");
    await native("fixture", imagePath);
    return prepareImage(
      nativeImage.createFromBuffer(await readFile(imagePath)),
      "Example · pricing table",
    );
  });
  handle("capture:analyze", async () => {
    if (!capture) throw new Error("Capture an image first.");
    const current = capture,
      job = startJob();
    current.phase = "reading";
    emit();
    try {
      current.analysis = await analyzeCapture(
        current,
        AbortSignal.any([job.signal, AbortSignal.timeout(20000)]),
      );
    } finally {
      if (capture?.id === current.id) {
        current.phase = "ready";
        emit();
      }
    }
    return current;
  });
  handle(
    "result:generate",
    async (id: string, action: ActionId, instruction = "") => {
      if (!capture || capture.id !== id)
        throw new Error("The screenshot changed. Select the action again.");
      if (!Object.hasOwn(ACTIONS, action) || typeof instruction !== "string")
        throw new Error("Invalid paste action.");
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
  handle("window:expand", () => {
    window.webContents.send("window:mode", false);
    window.setSize(1040, 760);
    window.center();
  });
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
    const shortcutOk = registerShortcut(settings.shortcut);
    tray = new Tray(trayIcon());
    tray.setToolTip("SnapPaste — capture what you see, paste what you need.");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Smart paste from clipboard",
          accelerator: settings.shortcut,
          click: () => {
            void showPanel(true);
          },
        },
        {
          label: "Open SnapPaste",
          click: () => {
            void showPanel();
          },
        },
        {
          label: "Settings…",
          click: () => {
            void showPanel().then(() =>
              window.webContents.send("settings:open"),
            );
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
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "SnapPaste",
          submenu: [
            { role: "about" },
            { type: "separator" },
            {
              label: "Smart paste from clipboard",
              click: () => {
                void showPanel(true);
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
      void showPanel();
    });
  });
}
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  controller?.abort();
  globalShortcut.unregisterAll();
  const cleanup = tempDirectory
    ? rm(tempDirectory, { recursive: true, force: true })
    : Promise.resolve();
  void cleanup.catch(() => {}).finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  /* Keep the menu-bar utility running. */
});
