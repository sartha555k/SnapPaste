import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Settings, SettingsUpdate } from "../shared/types";

interface Stored {
  shortcut: string;
  captureShortcut: string;
  watchClipboard: boolean;
  historyLimitMB: number;
  openaiModel: string;
  jevModel: string;
  cloudEnabled: boolean;
  prompts: Settings["prompts"];
  openaiSecret?: string;
  jevSecret?: string;
}
const defaults: Stored = {
  shortcut: "CommandOrControl+Alt+V",
  captureShortcut: "CommandOrControl+Alt+S",
  watchClipboard: false,
  historyLimitMB: 200,
  openaiModel: "gpt-4.1-mini",
  jevModel: "jev-1.14.0",
  cloudEnabled: false,
  prompts: [],
};
let stored: Stored | undefined;
function file() {
  return path.join(app.getPath("userData"), "settings.json");
}
function read(): Stored {
  if (stored) return stored;
  try {
    stored = {
      ...defaults,
      ...(existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}),
    };
  } catch {
    stored = { ...defaults };
  }
  return stored!;
}
export function secret(provider: "openai" | "jev"): string {
  const encrypted =
    read()[provider === "openai" ? "openaiSecret" : "jevSecret"];
  if (!encrypted) return "";
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return "";
  }
}
export function getSettings(): Settings {
  const s = read();
  return {
    shortcut: s.shortcut,
    captureShortcut: s.captureShortcut,
    watchClipboard: s.watchClipboard,
    historyLimitMB: s.historyLimitMB,
    openaiModel: s.openaiModel,
    jevModel: s.jevModel,
    cloudEnabled: s.cloudEnabled,
    prompts: s.prompts,
    hasOpenAIKey: !!secret("openai"),
    hasJevKey: !!secret("jev"),
  };
}
export function validateSettings(update: SettingsUpdate): void {
  if (
    !update ||
    typeof update.captureShortcut !== "string" ||
    !update.captureShortcut.trim() ||
    update.captureShortcut === update.shortcut ||
    typeof update.watchClipboard !== "boolean" ||
    !Number.isFinite(update.historyLimitMB) ||
    update.historyLimitMB < 50 ||
    update.historyLimitMB > 2000 ||
    typeof update.shortcut !== "string" ||
    !update.shortcut.trim() ||
    typeof update.openaiModel !== "string" ||
    !/^[\w.:-]{1,100}$/.test(update.openaiModel) ||
    typeof update.jevModel !== "string" ||
    !/^[\w.:-]{1,100}$/.test(update.jevModel) ||
    typeof update.cloudEnabled !== "boolean"
  )
    throw new Error("Check the shortcut and model names.");
  if (
    !Array.isArray(update.prompts) ||
    update.prompts.length > 30 ||
    update.prompts.some(
      (p) =>
        typeof p.id !== "string" ||
        typeof p.name !== "string" ||
        typeof p.instruction !== "string" ||
        !p.name.trim() ||
        !p.instruction.trim() ||
        p.instruction.length > 4000 ||
        p.name.length > 80,
    )
  )
    throw new Error(
      "Saved prompts need a name and an instruction (maximum 30 prompts).",
    );
  for (const key of [update.openaiKey, update.jevKey])
    if (key !== undefined && (typeof key !== "string" || key.length > 1000))
      throw new Error("Invalid API key.");
}
export function saveSettings(update: SettingsUpdate): Settings {
  validateSettings(update);
  const current = read();
  const next: Stored = {
    ...current,
    shortcut: update.shortcut,
    captureShortcut: update.captureShortcut,
    watchClipboard: update.watchClipboard,
    historyLimitMB: update.historyLimitMB,
    openaiModel: update.openaiModel.trim(),
    jevModel: update.jevModel.trim(),
    cloudEnabled: update.cloudEnabled,
    prompts: update.prompts,
  };
  for (const provider of ["openai", "jev"] as const) {
    const key = provider === "openai" ? update.openaiKey : update.jevKey;
    const clear =
      provider === "openai" ? update.clearOpenAIKey : update.clearJevKey;
    const field = provider === "openai" ? "openaiSecret" : "jevSecret";
    if (clear) delete next[field];
    else if (key?.trim()) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "macOS secure storage is unavailable. Your key was not saved.",
        );
      next[field] = safeStorage.encryptString(key.trim()).toString("base64");
    }
  }
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  stored = next;
  return getSettings();
}
