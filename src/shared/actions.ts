import type { ActionId, Analysis, Category, PasteAction } from "./types";
function option(
  id: string,
  title: string,
  prompt: string,
  icon: PasteAction["icon"] = "sparkles",
): PasteAction {
  return {
    id,
    title,
    prompt,
    icon,
    description:
      id === "text" ? "Extract text on your Mac" : "Ready-to-paste content",
    badge: id === "text" ? "ON DEVICE" : "AI",
    cloud: id !== "text",
  };
}
// Minimal safe fallback only. Production menus come from the catalogue.
export const ACTIONS: Record<string, PasteAction> = Object.fromEntries(
  [
    option("text", "Just the text", "Transcribe visible text.", "text"),
    option(
      "formatted",
      "Clean formatting",
      "Preserve visible headings, paragraphs and lists.",
    ),
    option(
      "summary",
      "Short factual summary",
      "Condense visible facts for sharing. Do not explain, advise or infer.",
    ),
    option(
      "custom",
      "Your instruction",
      "Follow the explicit user transformation without inventing facts.",
    ),
    option(
      "spreadsheet",
      "Spreadsheet cells",
      "Extract visible rows and columns.",
      "table",
    ),
    option(
      "table-markdown",
      "Formatted table",
      "Extract visible rows and columns.",
      "table",
    ),
    option(
      "table-json",
      "Structured JSON",
      "Extract visible records as JSON.",
      "code",
    ),
    option(
      "code-extract",
      "Formatted code",
      "Transcribe visible code without fixing or completing it.",
      "code",
    ),
    option(
      "bug-report",
      "Failure handoff",
      "Share only visible failure details. Do not diagnose.",
      "code",
    ),
    option(
      "pr-summary",
      "Visible changes",
      "List only changes visible in the screenshot.",
      "code",
    ),
    option(
      "receipt",
      "Expense details",
      "Extract visible merchant, date, currency and total.",
      "receipt",
    ),
    option(
      "receipt-items",
      "Itemised table",
      "Extract visible receipt items.",
      "table",
    ),
    option(
      "event",
      "Event details",
      "Extract visible event details.",
      "calendar",
    ),
    option(
      "chat-decisions",
      "Decisions and questions",
      "Extract explicit decisions and unresolved questions.",
    ),
    option(
      "chat-tasks",
      "Action items",
      "Extract explicitly assigned actions.",
    ),
    option(
      "chat-handoff",
      "Conversation handoff",
      "Condense visible conversation facts for sharing.",
    ),
    option(
      "chart-data",
      "Labelled chart data",
      "Extract only explicitly labelled values.",
      "table",
    ),
  ].map((a) => [a.id, a]),
);
export const CATEGORIES: Record<
  Category,
  { title: string; description: string; actions: ActionId[] }
> = {
  table: {
    title: "Tables and data",
    description: "Generic rows and columns",
    actions: ["spreadsheet", "table-markdown", "table-json"],
  },
  code: {
    title: "Developer material",
    description: "Code and visible errors",
    actions: ["code-extract", "bug-report", "pr-summary"],
  },
  receipt: {
    title: "Financial records",
    description: "Receipts and invoices",
    actions: ["receipt", "receipt-items", "formatted"],
  },
  event: {
    title: "Events",
    description: "Events and schedules",
    actions: ["event", "formatted", "summary"],
  },
  document: {
    title: "Documents",
    description: "Written reference material",
    actions: ["formatted", "summary", "custom"],
  },
  chat: {
    title: "Conversations",
    description: "Messages and email",
    actions: ["chat-handoff", "chat-decisions", "chat-tasks"],
  },
  chart: {
    title: "Charts",
    description: "Labelled visual data",
    actions: ["chart-data", "formatted", "summary"],
  },
  design: {
    title: "Visual content",
    description: "General visual content",
    actions: ["formatted", "summary", "custom"],
  },
  unknown: {
    title: "General screenshot",
    description: "Mixed or unclear content",
    actions: ["formatted", "summary", "custom"],
  },
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
  if (
    text.split("\n").filter((l) => /\d/.test(l)).length >= 3 &&
    /\b(price|plan|qty|quantity|amount|product|monthly|annual|users|seats|cost)\b/i.test(
      text,
    )
  )
    return "table";
  return "document";
}
export function chooseContextActions(
  category: Category,
  scores: Record<string, number>,
): PasteAction[] {
  const allowed = CATEGORIES[category].actions;
  const ranked = allowed
    .filter(
      (id) => Number.isFinite(scores[id]) && scores[id] >= 0 && scores[id] <= 1,
    )
    .sort((a, b) => scores[b] - scores[a]);
  const selected = [...new Set([...ranked, ...allowed])].slice(0, 3);
  return [ACTIONS.text, ...selected.map((id) => ACTIONS[id])];
}
export function localAnalysis(text: string): Analysis {
  const category = localCategory(text);
  return {
    category,
    source: "local",
    actions: chooseContextActions(category, {}),
    rankedActions: [],
    stage: "fallback",
  };
}
