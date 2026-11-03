export type Category =
  | "table"
  | "code"
  | "receipt"
  | "event"
  | "document"
  | "chat"
  | "chart"
  | "design"
  | "unknown";
export type ActionId =
  | "text"
  | "formatted"
  | "spreadsheet"
  | "summary"
  | "bug-report"
  | "message"
  | "receipt"
  | "event"
  | "custom"
  | "table-markdown"
  | "table-json"
  | "table-compare"
  | "table-email"
  | "code-extract"
  | "code-explain"
  | "pr-summary"
  | "review-comment"
  | "receipt-items"
  | "receipt-check"
  | "invoice-email"
  | "event-invite"
  | "event-agenda"
  | "event-checklist"
  | "document-outline"
  | "document-translate"
  | "document-email"
  | "chat-reply"
  | "chat-decisions"
  | "chat-tasks"
  | "chat-handoff"
  | "chart-data"
  | "chart-insights"
  | "chart-caption"
  | "chart-report"
  | "design-description"
  | "design-feedback"
  | "design-spec"
  | "design-alttext";
export interface PasteAction {
  id: ActionId;
  icon:
    | "text"
    | "table"
    | "code"
    | "message"
    | "receipt"
    | "calendar"
    | "chart"
    | "design"
    | "summary"
    | "sparkles";
  prompt: string;
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
  stage: "category" | "ranking" | "complete" | "fallback";
  rankedActions: { id: ActionId; score: number }[];
  categoryConfidence?: number;
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
  phase: "reading" | "classifying" | "ready";
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
  captureShortcut: string;
  watchClipboard: boolean;
  historyLimitMB: number;
  openaiModel: string;
  jevModel: string;
  cloudEnabled: boolean;
  hasOpenAIKey: boolean;
  hasJevKey: boolean;
  prompts: SavedPrompt[];
}
export interface SettingsUpdate {
  shortcut: string;
  captureShortcut: string;
  watchClipboard: boolean;
  historyLimitMB: number;
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
  listHistory(offset?: number): Promise<HistoryPage>;
  selectHistory(id: string): Promise<void>;
  onHistory(callback: () => void): () => void;
  readClipboard(): Promise<Capture>;
  importImage(): Promise<HistoryItem | null>;
  captureScreen(): Promise<HistoryItem | null>;
  loadExample(kind?: "table" | "code"): Promise<HistoryItem>;
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

export interface HistoryItem {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
  thumbnail: string;
}
export interface HistoryPage {
  items: HistoryItem[];
  total: number;
  bytes: number;
  limitBytes: number;
  hasMore: boolean;
}
