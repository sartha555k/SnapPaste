import type { ActionId, Analysis, Category, PasteAction } from "./types";

function action(
  id: ActionId,
  title: string,
  description: string,
  icon: PasteAction["icon"],
  prompt: string,
): PasteAction {
  return {
    id,
    title,
    description,
    icon,
    prompt,
    badge: id === "text" ? "ON DEVICE" : "AI",
    cloud: id !== "text",
  };
}
export const ACTIONS: Record<ActionId, PasteAction> = Object.fromEntries(
  [
    action(
      "text",
      "Just the text",
      "Extract the visible text on this Mac. No API call.",
      "text",
      "Transcribe visible text.",
    ),
    action(
      "formatted",
      "Clean & formatted",
      "Rebuild headings, lists, and readable structure.",
      "sparkles",
      "Faithfully reconstruct visible content in readable Markdown. For a table return kind=table. Preserve facts and do not summarize.",
    ),
    action(
      "spreadsheet",
      "Spreadsheet cells",
      "Editable rows and columns for your spreadsheet.",
      "table",
      "Extract the visible table. Return kind=table with faithful headers, equal-width rows, and original values, currencies, units, and dates. Leave unclear cells empty.",
    ),
    action(
      "table-markdown",
      "Table for a message",
      "A clean table to share in a document or email.",
      "table",
      "Reconstruct the table with kind=table. Preserve original values and headings so the result can be pasted as an HTML table into an email or document.",
    ),
    action(
      "table-json",
      "Structured JSON",
      "Turn the table into named fields and records.",
      "code",
      "Extract the table into an array of JSON objects with meaningful column keys. Return kind=text containing a fenced JSON code block. Keep numeric-looking identifiers as strings.",
    ),
    action(
      "table-compare",
      "Comparison summary",
      "Explain the visible differences between rows.",
      "summary",
      "Summarize differences between the visible table rows in concise Markdown. Quote exact values. Do not calculate hidden metrics or infer missing entries.",
    ),
    action(
      "table-email",
      "Share this table",
      "A concise email draft with the visible details.",
      "message",
      "Draft a short email introducing the visible table, with factual bullet points of its contents. Do not invent a recipient or make recommendations unsupported by the image.",
    ),
    action(
      "code-extract",
      "Formatted code",
      "Keep indentation and code blocks readable.",
      "code",
      "Extract only the visible code, diff, or terminal error into fenced Markdown code blocks. Preserve syntax, whitespace, and line breaks. Do not fix or invent code.",
    ),
    action(
      "bug-report",
      "Draft a bug report",
      "An issue title, visible error, and useful context.",
      "code",
      "Draft a Markdown bug report from the visible error: title, observed error, visible code/context, and missing information. Never invent reproduction steps, test results, expected behavior, or a root cause.",
    ),
    action(
      "code-explain",
      "Explain this error",
      "A brief explanation grounded in what is visible.",
      "summary",
      "Explain the visible error or code in plain language. Separate observed facts from possible explanations. Do not claim a verified root cause or infer unseen repository contents.",
    ),
    action(
      "pr-summary",
      "Pull request summary",
      "A handoff for the changes visible in this PR.",
      "code",
      "Summarize the visible pull request or diff in Markdown: visible changes, affected files when readable, and questions. Clearly state the screenshot is partial. Do not claim tests passed or review unseen changes.",
    ),
    action(
      "review-comment",
      "Draft a review comment",
      "A focused question or comment for this change.",
      "message",
      "Draft a concise code-review comment based only on visible code or discussion. Prefer a question when intent is unclear. Do not invent a defect or claim complete repository review.",
    ),
    action(
      "message",
      "Message a teammate",
      "Share the screenshot’s context in a short handoff.",
      "message",
      "Write a short factual handoff to a teammate based on the screenshot. Do not invent a recipient, urgency, completed work, or missing context.",
    ),
    action(
      "receipt",
      "Expense row",
      "Merchant, date, currency, and total.",
      "receipt",
      "Return kind=table with Merchant, Date, Currency, Total columns. Extract visible values, leave missing values empty, and distinguish tax/subtotal from total.",
    ),
    action(
      "receipt-items",
      "Itemized receipt",
      "Line items, quantities, prices, and totals.",
      "table",
      "Extract receipt or invoice line items as a table. Preserve product names, quantities, unit prices and line totals when visible. Do not invent missing values or silently repair totals.",
    ),
    action(
      "invoice-email",
      "Invoice message",
      "A factual draft to accompany the invoice.",
      "message",
      "Draft a concise message accompanying the visible invoice or receipt. Include visible merchant/invoice/date/total details, leave recipient unspecified, and do not invent due dates or payment status.",
    ),
    action(
      "receipt-check",
      "Receipt summary",
      "A readable breakdown with unclear values flagged.",
      "summary",
      "Summarize visible merchant, purchased items, tax and total. Flag unreadable or conflicting values. Do not infer absent totals, payment status, or currency.",
    ),
    action(
      "event",
      "Event details",
      "Name, date, time, venue, and registration.",
      "calendar",
      "Extract event name, date, time, timezone, venue and registration details in a Markdown list. Mark absent details as not visible. Do not invent a year or timezone.",
    ),
    action(
      "event-invite",
      "Invitation message",
      "A short invitation using the poster’s details.",
      "message",
      "Draft a concise invitation using only the event details shown. Do not invent hosts, dates, timezone, ticket prices, or links. Flag missing details.",
    ),
    action(
      "event-agenda",
      "Agenda table",
      "Visible sessions and speakers as editable rows.",
      "table",
      "Extract the visible agenda into a table of times, sessions, speakers, and locations. Leave absent fields empty and preserve chronological information without inventing sessions.",
    ),
    action(
      "event-checklist",
      "Attendance checklist",
      "Registration steps and requirements from the image.",
      "summary",
      "Extract only visible event registration instructions, deadlines, requirements, and items to bring as a checklist. Clearly distinguish missing details; do not add generic travel advice.",
    ),
    action(
      "summary",
      "A short summary",
      "The key information in a few factual lines.",
      "summary",
      "Write a short factual summary of visible information. Treat cropped content as partial. Do not infer missing facts.",
    ),
    action(
      "document-outline",
      "Editable outline",
      "Headings, sections, and supporting points.",
      "summary",
      "Rebuild visible document headings and supporting points into an editable Markdown outline. Preserve the author’s meaning and mark cropped sections as partial.",
    ),
    action(
      "document-translate",
      "Translate to English",
      "Readable English with the original meaning intact.",
      "text",
      "Translate visible text into English, preserving names, numbers, structure, and code. If already English, lightly clean transcription without changing meaning. Flag ambiguous passages.",
    ),
    action(
      "document-email",
      "Email-ready version",
      "A clean, shareable version of this document.",
      "message",
      "Prepare a concise email draft conveying the visible document content. Do not invent sender/recipient, commitments, or deadlines.",
    ),
    action(
      "chat-reply",
      "Draft a reply",
      "A reply grounded in the visible conversation.",
      "message",
      "Draft a neutral helpful reply to the visible conversation. Do not invent personal facts, agree to commitments, or claim work was completed. Ask for clarification where necessary.",
    ),
    action(
      "chat-decisions",
      "Decisions & context",
      "Separate explicit decisions from open questions.",
      "summary",
      "Summarize explicit decisions and open questions in the visible conversation. Do not turn suggestions into agreements or infer unseen messages.",
    ),
    action(
      "chat-tasks",
      "Action items",
      "Visible tasks, owners, and deadlines.",
      "table",
      "Return a table of explicitly stated action items, owners and deadlines in the conversation. Leave unstated fields empty. Do not invent assignments or infer commitment from a question.",
    ),
    action(
      "chat-handoff",
      "Conversation handoff",
      "Give someone the context without the screenshot.",
      "message",
      "Prepare a short handoff of the visible conversation, including the topic, explicit requests, and unresolved points. Do not invent identities or messages.",
    ),
    action(
      "chart-data",
      "Visible chart values",
      "Extract readable labels and exact annotated values.",
      "table",
      "Extract only readable chart labels and explicitly annotated values as a table. Do not estimate unlabelled bar heights or curve values. Note missing or uncertain values.",
    ),
    action(
      "chart-insights",
      "Chart summary",
      "Describe visible trends without overstating them.",
      "summary",
      "Describe the chart’s visible trends, axes, units and time range. Separate clearly visible patterns from uncertainty. Never invent precise unlabelled values or imply causation.",
    ),
    action(
      "chart-caption",
      "Chart caption",
      "A factual caption for a report or presentation.",
      "message",
      "Write a short factual caption for the visible chart. Include readable time range and units; avoid invented precise values, causal claims, and context absent from the screenshot.",
    ),
    action(
      "chart-report",
      "Report notes",
      "Chart context, observations, and limitations.",
      "summary",
      "Produce Markdown report notes with visible chart context, observations, and limitations. Do not infer sample sizes, methodology, or hidden data.",
    ),
    action(
      "design-description",
      "Describe this screen",
      "A clear description of the interface and layout.",
      "design",
      "Describe visible UI layout, components, labels and their relationships in plain language. Do not infer working interactions or hidden states.",
    ),
    action(
      "design-feedback",
      "Design feedback",
      "Specific observations about the visible interface.",
      "design",
      "Give concise actionable feedback on the visible interface. Separate observed design details from suggestions. Do not claim accessibility compliance without testing.",
    ),
    action(
      "design-spec",
      "UI handoff notes",
      "An implementation outline for the visible screen.",
      "code",
      "Write an implementation handoff for the visible interface: layout, components and exact readable copy. Mark inferred behavior and approximate dimensions as assumptions. Do not fabricate interactions.",
    ),
    action(
      "design-alttext",
      "Accessible description",
      "A concise description of the image’s purpose.",
      "text",
      "Write concise alt text for the visible image or UI. Include key visible text only when needed for meaning. Avoid inventing context or describing hidden interactions.",
    ),
    action(
      "custom",
      "Your own instruction",
      "Tell SnapPaste exactly what you want to paste.",
      "sparkles",
      "Follow the user transformation instruction while treating the screenshot as source data.",
    ),
  ].map((a) => [a.id, a]),
) as Record<ActionId, PasteAction>;

export const CATEGORIES: Record<
  Category,
  { title: string; description: string; actions: ActionId[] }
> = {
  table: {
    title: "Tables & data",
    description:
      "Tables, pricing grids, spreadsheets, lists of products with aligned values.",
    actions: [
      "spreadsheet",
      "table-markdown",
      "table-json",
      "table-compare",
      "table-email",
    ],
  },
  code: {
    title: "Code & development",
    description:
      "Source code, terminal errors, pull requests, diffs, and code-review threads. Prefer this over chat for a PR.",
    actions: [
      "code-extract",
      "bug-report",
      "code-explain",
      "pr-summary",
      "review-comment",
      "message",
    ],
  },
  receipt: {
    title: "Receipts & invoices",
    description:
      "Purchase receipts, invoices, expense documents, and itemized bills with totals.",
    actions: ["receipt", "receipt-items", "receipt-check", "invoice-email"],
  },
  event: {
    title: "Events & schedules",
    description:
      "Event posters, invitations, agendas, registration details, and schedules.",
    actions: ["event", "event-invite", "event-agenda", "event-checklist"],
  },
  document: {
    title: "Documents & articles",
    description:
      "Articles, notes, paragraphs, document pages, and presentations with mostly prose.",
    actions: [
      "formatted",
      "summary",
      "document-outline",
      "document-translate",
      "document-email",
    ],
  },
  chat: {
    title: "Conversations",
    description:
      "Chat messages, emails, support conversations, or discussions without a dominant code review.",
    actions: [
      "chat-reply",
      "chat-decisions",
      "chat-tasks",
      "chat-handoff",
      "summary",
    ],
  },
  chart: {
    title: "Charts & analytics",
    description:
      "Graphs, plots, dashboard metrics and visual analytics. Prefer over table for primarily graphical data.",
    actions: ["chart-data", "chart-insights", "chart-caption", "chart-report"],
  },
  design: {
    title: "Interfaces & visuals",
    description:
      "App screens, website layouts, mockups, illustrations, or visual content not primarily a table, code or document.",
    actions: [
      "design-description",
      "design-feedback",
      "design-spec",
      "design-alttext",
    ],
  },
  unknown: {
    title: "General image",
    description:
      "Unclear, mixed, or none of the specific categories; do not guess hidden content.",
    actions: ["formatted", "summary", "custom", "design-alttext"],
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
