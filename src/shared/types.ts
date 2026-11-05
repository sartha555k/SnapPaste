export type Category = string;
export type ActionId = string;
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
  processor?: "local_ocr" | "ai" | "app_control";
  outputFormat?: string;
  executionRules?: string;
  contextInstruction?: string;
  localFirst?: boolean;
}
export interface Analysis {
  category: Category;
  categoryTitle?: string;
  subcategory?: string;
  subcategoryTitle?: string;
  catalogueVersion?: string;
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
  local?: LocalExtraction;
  preparedActions?: string[];
  preparingActions?: string[];
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
  values?: { label: string; value: string }[];
  outputFormat?: string;
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
  boostMode: boolean;
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
  boostMode: boolean;
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
  paletteSelect(id: string): Promise<void>;
  paletteRun(
    id: string,
    action: ActionId,
  ): Promise<"pasted" | "copied" | "cancelled" | { result: PasteResult }>;
  paletteMatch(ids: string[]): Promise<GroupMenu>;
  paletteGenerate(
    ids: string[],
    action: ActionId,
    instruction?: string,
  ): Promise<PasteResult | "pasted" | "copied">;
  palettePaste(result: PasteResult): Promise<string>;
  cropCapture(
    id: string,
    region: { x: number; y: number; width: number; height: number },
  ): Promise<void>;
  catalogueStatus(): Promise<{
    source: string;
    categories: number;
    subcategories: number;
    fetchedAt: string | null;
    error?: string;
  }>;
  paletteClose(): Promise<void>;
  paletteResize(height: number): Promise<void>;
  paletteLibrary(): Promise<void>;
  onPaletteOpen(callback: (state: PaletteOpen) => void): () => void;
}
export interface GroupMenu {
  title: string;
  actions: PasteAction[];
  warning?: string;
}
export interface PaletteOpen {
  together: boolean;
  groupIds: string[];
  groupMenu?: GroupMenu;
  cloudReady: boolean;
  items: Pick<HistoryItem, "id" | "name" | "createdAt" | "thumbnail">[];
  app: string;
  trusted: boolean;
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

export interface LocalExtraction {
  text: string;
  tables: { rows: string[][]; simple: boolean }[];
  values: { label: string; value: string }[];
}
