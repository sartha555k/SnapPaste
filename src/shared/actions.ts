import type { ActionId, Analysis, Category, PasteAction } from "./types";
export const ACTIONS: Record<ActionId, PasteAction> = {
  text: {
    id: "text",
    title: "Just the text",
    description: "The words you need, without the image.",
    badge: "ON DEVICE",
    cloud: false,
  },
  formatted: {
    id: "formatted",
    title: "Clean & formatted",
    description: "Keep the structure. Lose the cleanup.",
    badge: "AI",
    cloud: true,
  },
  spreadsheet: {
    id: "spreadsheet",
    title: "Spreadsheet cells",
    description: "Real rows and columns, ready for your sheet.",
    badge: "AI",
    cloud: true,
  },
  summary: {
    id: "summary",
    title: "A short summary",
    description: "The important details, in a few lines.",
    badge: "AI",
    cloud: true,
  },
  "bug-report": {
    id: "bug-report",
    title: "Draft a bug report",
    description: "An issue title, visible error, and code context.",
    badge: "AI",
    cloud: true,
  },
  message: {
    id: "message",
    title: "Message a teammate",
    description: "Turn what you captured into a useful handoff.",
    badge: "AI",
    cloud: true,
  },
  receipt: {
    id: "receipt",
    title: "Expense details",
    description: "Merchant, date, currency, and total.",
    badge: "AI",
    cloud: true,
  },
  event: {
    id: "event",
    title: "Event details",
    description: "The what, when, and where in one place.",
    badge: "AI",
    cloud: true,
  },
  custom: {
    id: "custom",
    title: "Your own instruction",
    description: "Tell SnapPaste exactly what to extract.",
    badge: "AI",
    cloud: true,
  },
};
export const contextual: Record<Category, ActionId[]> = {
  table: ["spreadsheet", "summary"],
  code: ["bug-report", "message"],
  receipt: ["receipt", "spreadsheet"],
  event: ["event", "message"],
  document: ["summary", "message"],
  unknown: ["summary", "custom"],
};
export function localCategory(text: string): Category {
  if (!text.trim()) return "unknown";
  if (
    /\b(total|subtotal|tax|receipt|invoice|merchant)\b/i.test(text) &&
    /[$€£₹]|\bUSD\b|\bINR\b/.test(text)
  )
    return "receipt";
  if (
    /\b(TypeError|SyntaxError|ReferenceError|Exception|Traceback|pull request|stack trace|npm ERR|undefined|const |function |return |import |diff --git)\b/i.test(
      text,
    )
  )
    return "code";
  if (
    /\b(event|register|tickets|venue|conference|meetup)\b/i.test(text) &&
    /\b(am|pm|monday|tuesday|wednesday|thursday|friday|saturday|sunday|202\d)\b/i.test(
      text,
    )
  )
    return "event";
  const numericLines = text.split("\n").filter((l) => /\d/.test(l));
  if (
    numericLines.length >= 3 &&
    /\b(price|plan|qty|quantity|amount|product|monthly|annual|users|seats|cost)\b/i.test(
      text,
    )
  )
    return "table";
  return "document";
}
export function localAnalysis(text: string): Analysis {
  const category = localCategory(text);
  return {
    category,
    source: "local",
    actions: ["text", "formatted", ...contextual[category]].map(
      (id) => ACTIONS[id as ActionId],
    ),
  };
}
export function chooseContextActions(
  category: Category,
  scores: Record<string, number>,
): PasteAction[] {
  const candidates = Object.keys(ACTIONS).filter(
    (id) => !["text", "formatted", "custom"].includes(id),
  ) as ActionId[];
  const ranked = candidates
    .filter((id) => Number.isFinite(scores[id]) && scores[id] >= 0.5)
    .sort((a, b) => scores[b] - scores[a]);
  const selected = [
    ...new Set([...ranked, ...contextual[category], "custom" as ActionId]),
  ].slice(0, 2);
  return [
    ACTIONS.text,
    ACTIONS.formatted,
    ...selected.map((id) => ACTIONS[id]),
  ];
}
