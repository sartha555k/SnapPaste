export type Category =
  "table" | "code" | "receipt" | "event" | "document" | "unknown";
export type ActionId =
  | "text"
  | "formatted"
  | "spreadsheet"
  | "summary"
  | "bug-report"
  | "message"
  | "receipt"
  | "event"
  | "custom";
export interface PasteAction {
  id: ActionId;
  title: string;
  description: string;
  badge: string;
  cloud: boolean;
}
export interface Analysis {
  category: Category;
  source: "local" | "jev" | "gpt";
  actions: PasteAction[];
  warning?: string;
}
export interface Capture {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  ocrText: string;
  analysis: Analysis;
  phase: "reading" | "ready";
}
export interface PasteResult {
  actionId: ActionId;
  kind: "text" | "table";
  text: string;
  headers: string[];
  rows: string[][];
  notes: string[];
  source: "Apple Vision" | "OpenAI";
  elapsedMs: number;
}
export interface SavedPrompt {
  id: string;
  name: string;
  instruction: string;
}
export interface Settings {
  shortcut: string;
  openaiModel: string;
  jevModel: string;
  cloudEnabled: boolean;
  hasOpenAIKey: boolean;
  hasJevKey: boolean;
  prompts: SavedPrompt[];
}
export interface SettingsUpdate {
  shortcut: string;
  openaiModel: string;
  jevModel: string;
  cloudEnabled: boolean;
  openaiKey?: string;
  jevKey?: string;
  clearOpenAIKey?: boolean;
  clearJevKey?: boolean;
  prompts: SavedPrompt[];
}
export interface Permissions {
  accessibility: boolean;
  screen: string;
}
export interface SnapPasteAPI {
  getSettings(): Promise<Settings>;
  saveSettings(settings: SettingsUpdate): Promise<Settings>;
  getCapture(): Promise<Capture | null>;
  readClipboard(): Promise<Capture>;
  importImage(): Promise<Capture | null>;
  captureScreen(): Promise<Capture | null>;
  loadExample(): Promise<Capture>;
  analyze(): Promise<Capture>;
  generate(
    id: string,
    action: ActionId,
    instruction?: string,
  ): Promise<PasteResult>;
  copy(result: PasteResult): Promise<void>;
  paste(result: PasteResult): Promise<void>;
  cancel(): Promise<void>;
  hide(): Promise<void>;
  expand(): Promise<void>;
  permissions(): Promise<Permissions>;
  openPermission(kind: "accessibility" | "screen"): Promise<void>;
  onCapture(callback: (capture: Capture | null) => void): () => void;
  onNotice(callback: (notice: string) => void): () => void;
  onSettings(callback: () => void): () => void;
  onMode(callback: (compact: boolean) => void): () => void;
}
declare global {
  interface Window {
    snapPaste: SnapPasteAPI;
  }
}
