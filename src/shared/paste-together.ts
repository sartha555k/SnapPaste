import { ACTIONS } from "./actions";
import type { Capture, PasteAction, PasteResult } from "./types";

export const GROUP_CAPTURE_SHORTCUT = "CommandOrControl+Alt+G";
export const PASTE_TOGETHER_SHORTCUT = "CommandOrControl+Alt+P";
export type ScreenshotSource = Pick<Capture, "name" | "dataUrl" | "ocrText">;

export const CUSTOM_PASTE: PasteAction = {
  id: "custom",
  title: "Write your own…",
  description: "Tell SnapPaste exactly what to paste",
  prompt:
    "Follow the user's requested transformation using the selected screenshots.",
  icon: "sparkles",
  cloud: true,
  badge: "AI",
};

function option(
  id: string,
  title: string,
  prompt: string,
  outputFormat = "text",
): PasteAction {
  return {
    id,
    title,
    description:
      outputFormat === "tsv"
        ? "Paste as editable cells"
        : "Paste from the selected screenshots",
    prompt,
    icon: outputFormat === "tsv" ? "table" : "sparkles",
    outputFormat,
    badge: "AI",
    cloud: true,
  };
}

export const togetherCases = {
  marksheets: {
    title: "Semester marksheets",
    evidence:
      "The same student's name or ID and distinct printed terms. Pages of one term do not qualify. Reject conflicting names or IDs.",
    actions: [
      option(
        "compare_marks",
        "Compare marks by subject",
        "Make one row per subject and one column per printed semester in term order. Match by subject code where available. Leave missing marks blank. Preserve each printed mark and its scale.",
        "tsv",
      ),
      option(
        "semester_results",
        "Paste results by semester",
        "List only explicitly printed totals, GPA, grades, and outcomes under their semester labels.",
      ),
      option(
        "changed_marks",
        "Show changed marks",
        "List subjects with different visible marks and show the sequence by semester. Compare only the same subject and grading scale.",
      ),
    ],
  },
  split_table: {
    title: "Parts of one table",
    evidence:
      "The same table heading or column layout, with shared rows, explicit page continuity, or visible row numbering showing continuation. Different tables with similar headers do not qualify.",
    actions: [
      option(
        "join_table",
        "Join rows with one header",
        "Join the visible rows in document order with one header. Remove only confirmed boundary overlap. Keep legitimately repeated rows. Mark missing sections.",
        "tsv",
      ),
      option(
        "table_csv",
        "Paste rows as CSV",
        "Join visible rows in document order and return CSV with one header. Remove only confirmed boundary overlap. Preserve empty cells and quote fields correctly.",
        "csv",
      ),
      option(
        "table_ids",
        "Copy record IDs in order",
        "List visible record identifiers in document order. Skip duplicates only where the screenshots demonstrably overlap.",
      ),
    ],
  },
  chat: {
    title: "One conversation",
    evidence:
      "The same conversation with matching participants or title and visible overlapping messages. Similar chat layouts alone do not qualify.",
    actions: [
      option(
        "chat_thread",
        "Paste conversation in order",
        "Transcribe messages with visible sender names and timestamps. Remove only matching overlap and preserve separate repeated messages.",
      ),
      option(
        "chat_by_sender",
        "Group messages by sender",
        "Group visible messages by known sender, keeping the original order within each group. Label unattributed messages separately.",
      ),
      option(
        "chat_details",
        "Extract dates and links mentioned",
        "List visible dates, times, and URLs with the message context. Preserve exact dates and URLs.",
      ),
    ],
  },
  event: {
    title: "Event poster and ticket",
    evidence:
      "One poster and one ticket for the same event, with a shared event name and supporting details such as date or venue. Reject conflicting event dates or venues.",
    actions: [
      option(
        "event_plan",
        "Paste a group chat plan",
        "Write a compact message using the visible event name, date, time, venue, and entry details. Distinguish door time from show time.",
      ),
      option(
        "event_lineup",
        "Paste the lineup with times",
        "List the printed acts or sessions with their exact times in order. Leave missing times out.",
      ),
      option(
        "event_entry",
        "Copy gate and entry instructions",
        "Extract only visible entry instructions, gate, entry time and venue. Omit ticket barcodes and QR payloads.",
      ),
    ],
  },
  pricing: {
    title: "Pricing snapshots",
    evidence:
      "The same product and comparable plan names, with explicit dates, version labels, or earlier-to-later order confirmed by the selection. Competitor listings do not qualify.",
    actions: [
      option(
        "compare_plans",
        "Compare plans side by side",
        "Match plans by name and list the visible prices and billing periods from each selected image. Label periods using visible dates or screenshot numbers.",
        "tsv",
      ),
      option(
        "price_changes",
        "Show price changes",
        "Show changes for matching plans only when currency and billing period match. Preserve old and new prices exactly.",
      ),
      option(
        "plan_features",
        "Show plan feature changes",
        "List visible feature differences per matching plan. Distinguish absent evidence from a confirmed removal.",
      ),
    ],
  },
  receipts: {
    title: "Receipt batch",
    evidence:
      "Each selected image is a purchase receipt. The user-selected set defines the batch. Do not infer a common trip or merge two distinct purchases.",
    actions: [
      option(
        "expense_rows",
        "Paste one expense row per receipt",
        "Make a table with one row per distinct receipt and columns for merchant, date, printed total and currency. Leave missing cells blank.",
        "tsv",
      ),
      option(
        "receipt_items",
        "Combine itemized purchases",
        "Make a table of visible line items with a source receipt column. Keep currencies and printed quantities separate.",
        "tsv",
      ),
      option(
        "receipt_totals",
        "List printed totals and currencies",
        "List each receipt's printed total with its merchant and currency if visible. Do not sum or convert amounts.",
      ),
    ],
  },
} satisfies Record<
  string,
  { title: string; evidence: string; actions: PasteAction[] }
>;

export type TogetherCase = keyof typeof togetherCases;
export const TOGETHER_FALLBACK = [
  option(
    "group_details",
    "Paste key details by screenshot",
    "Extract the main visible names, dates, and values. Keep each screenshot separate and labeled.",
  ),
  option(
    "group_table",
    "Paste a table of visible details",
    "Make one row per screenshot and use columns for comparable visible fields. Label each source and leave absent cells blank.",
    "tsv",
  ),
  option(
    "group_references",
    "Collect links and references",
    "List exact visible URLs, reference numbers, and identifiers, labeled by screenshot. Leave missing values out.",
  ),
];

export const TOGETHER_TEXT: PasteAction = {
  ...ACTIONS.text,
  description: "Combine text from the selected screenshots on your Mac",
};

export function combineScreenshotText(
  sources: Pick<ScreenshotSource, "ocrText">[],
): PasteResult {
  if (!sources.some((source) => source.ocrText.trim()))
    throw new Error("No readable text found in the selected screenshots.");
  return {
    actionId: "text",
    kind: "text",
    text: sources
      .map(
        (source, i) =>
          `Screenshot ${i + 1}\n${source.ocrText.trim() ? source.ocrText : "[No readable text]"}`,
      )
      .join("\n\n"),
    headers: [],
    rows: [],
    notes: [],
    source: "Apple Vision",
    elapsedMs: 0,
    outputFormat: "text",
  };
}
