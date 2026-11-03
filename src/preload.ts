import { contextBridge, ipcRenderer } from "electron";
import type { Capture, SnapPasteAPI } from "./shared/types";
const api: SnapPasteAPI = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (value) => ipcRenderer.invoke("settings:save", value),
  getCapture: () => ipcRenderer.invoke("capture:get"),
  readClipboard: () => ipcRenderer.invoke("capture:clipboard"),
  importImage: () => ipcRenderer.invoke("capture:import"),
  captureScreen: () => ipcRenderer.invoke("capture:screen"),
  loadExample: () => ipcRenderer.invoke("capture:example"),
  analyze: () => ipcRenderer.invoke("capture:analyze"),
  generate: (id, action, instruction) =>
    ipcRenderer.invoke("result:generate", id, action, instruction),
  copy: (result) => ipcRenderer.invoke("result:copy", result),
  paste: (result) => ipcRenderer.invoke("result:paste", result),
  cancel: () => ipcRenderer.invoke("job:cancel"),
  hide: () => ipcRenderer.invoke("window:hide"),
  expand: () => ipcRenderer.invoke("window:expand"),
  permissions: () => ipcRenderer.invoke("permissions:get"),
  openPermission: (kind) => ipcRenderer.invoke("permissions:open", kind),
  onCapture: (callback) => {
    const listener = (_: Electron.IpcRendererEvent, value: Capture | null) =>
      callback(value);
    ipcRenderer.on("capture", listener);
    return () => {
      ipcRenderer.removeListener("capture", listener);
    };
  },
  onNotice: (callback) => {
    const listener = (_: Electron.IpcRendererEvent, value: string) =>
      callback(value);
    ipcRenderer.on("notice", listener);
    return () => {
      ipcRenderer.removeListener("notice", listener);
    };
  },
  onSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("settings:open", listener);
    return () => {
      ipcRenderer.removeListener("settings:open", listener);
    };
  },
  onMode: (callback) => {
    const listener = (_: Electron.IpcRendererEvent, compact: boolean) =>
      callback(compact);
    ipcRenderer.on("window:mode", listener);
    return () => {
      ipcRenderer.removeListener("window:mode", listener);
    };
  },
};
contextBridge.exposeInMainWorld("snapPaste", api);
