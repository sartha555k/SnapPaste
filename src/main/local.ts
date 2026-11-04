import type { Capture, PasteAction, PasteResult } from "../shared/types";
import { safeCell } from "../shared/format";

export function localOutput(
  capture: Capture,
  action: PasteAction,
): PasteResult | null {
  const base: PasteResult = {
    actionId: action.id,
    kind: "text",
    text: "",
    headers: [],
    rows: [],
    notes: [],
    source: "Apple Vision",
    elapsedMs: 0,
    outputFormat: action.outputFormat,
  };
  const text = capture.ocrText;
  if (action.id === "text" || action.id === "review_text") {
    if (!text.trim())
      throw new Error(
        "No readable text found. Try a clearer region or paste the original image.",
      );
    return { ...base, text };
  }
  if (["links", "address", "values"].includes(action.id)) {
    const values = capture.local?.values ?? [];
    const filtered =
      action.id === "links"
        ? values.filter((v) => v.label === "Link")
        : action.id === "address"
          ? values.filter((v) => v.label === "Address")
          : values;
    if (!filtered.length) return null;
    if (action.id === "links")
      return { ...base, text: filtered.map((v) => v.value).join("\n") };
    // Let the user choose, rather than silently pasting the wrong address/value.
    return { ...base, text: filtered[0].value, values: filtered };
  }
  if (action.id === "json") {
    try {
      const value = JSON.parse(text);
      return { ...base, text: JSON.stringify(value, null, 2) };
    } catch {
      return null;
    }
  }
  if (["cells", "table", "csv"].includes(action.id)) {
    const tables = capture.local?.tables ?? [];
    if (tables.length !== 1 || !tables[0].simple) return null;
    const matrix = tables[0].rows;
    if (
      matrix.length < 2 ||
      matrix[0].length < 2 ||
      matrix.some((row) => row.length !== matrix[0].length)
    )
      return null;
    if (action.id === "csv") {
      const quote = (s: string) => `"${safeCell(s).replace(/"/g, '""')}"`;
      return {
        ...base,
        text: matrix.map((row) => row.map(quote).join(",")).join("\r\n"),
      };
    }
    return {
      ...base,
      kind: "table",
      headers: matrix[0],
      rows: matrix.slice(1),
    };
  }
  return null;
}

export function annotateLocalActions(capture: Capture) {
  capture.analysis.actions = capture.analysis.actions.map((action) => {
    if (!action.localFirst) return action;
    let supported = false;
    try {
      supported = !!localOutput(capture, action);
    } catch {
      /* No readable result. */
    }
    return supported
      ? {
          ...action,
          cloud: false,
          badge: "ON DEVICE",
          description: "Ready on your Mac · no AI call",
        }
      : action;
  });
}
