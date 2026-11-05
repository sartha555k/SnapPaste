import type { PasteResult } from "./types";
export function escapeHtml(value: string): string {
  return (
    value
      .replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      )
      // Some rich-text paste targets guess a legacy encoding for HTML fragments.
      .replace(/[^\x00-\x7f]/gu, (c) => "&#" + c.codePointAt(0) + ";")
  );
}
export function markdownHtml(text: string): string {
  const inline = (line: string) =>
    escapeHtml(line)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  let code = false,
    list = false;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      if (list) {
        lines.push("</ul>");
        list = false;
      }
      lines.push(code ? "</code></pre>" : "<pre><code>");
      code = !code;
      continue;
    }
    if (code) {
      lines.push(`${escapeHtml(line)}\n`);
      continue;
    }
    const bullet = /^\s*[-*] (.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        lines.push("<ul>");
        list = true;
      }
      lines.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) {
      lines.push("</ul>");
      list = false;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      lines.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (line.trim()) lines.push(`<p>${inline(line)}</p>`);
  }
  if (list) lines.push("</ul>");
  if (code) lines.push("</code></pre>");
  return lines.join("");
}
export function safeCell(value: string): string {
  const clean = value.replace(/[\t\r\n]/g, " ");
  // Keep ordinary negative numbers; prevent source text becoming spreadsheet formulas.
  return /^[=+@]/.test(clean.trimStart()) ||
    /^-(?!\d+(?:\.\d+)?\s*$)/.test(clean.trimStart())
    ? `'${clean}`
    : clean;
}
export function clipboardPayload(result: PasteResult): {
  text: string;
  html: string;
} {
  if (result.kind !== "table")
    return {
      text: result.text,
      html:
        result.actionId === "text" ||
        ["text", "json", "csv"].includes(result.outputFormat ?? "")
          ? `<div style="white-space:pre-wrap">${escapeHtml(result.text)}</div>`
          : markdownHtml(result.text),
    };
  const width = result.headers.length;
  if (!width) throw new Error("The table needs at least one column.");
  const rows = [
    result.headers,
    ...result.rows.map((row) =>
      Array.from({ length: width }, (_, i) => row[i] ?? ""),
    ),
  ];
  const text = rows.map((row) => row.map(safeCell).join("\t")).join("\n");
  const html = `<table border="1" style="border-collapse:collapse">${rows.map((row, i) => `<tr>${row.map((cell) => `<${i ? "td" : "th"} style="padding:8px 12px">${escapeHtml(safeCell(cell))}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;
  return { text, html };
}
export function validateResult(
  value: unknown,
): Omit<PasteResult, "actionId" | "source" | "elapsedMs"> {
  if (!value || typeof value !== "object")
    throw new Error("The model returned an invalid result. Try again.");
  const r = value as Record<string, unknown>;
  if (
    !["text", "table"].includes(String(r.kind)) ||
    typeof r.text !== "string" ||
    !Array.isArray(r.headers) ||
    !r.headers.every((v) => typeof v === "string") ||
    !Array.isArray(r.rows) ||
    !r.rows.every(
      (row) => Array.isArray(row) && row.every((v) => typeof v === "string"),
    ) ||
    !Array.isArray(r.notes) ||
    !r.notes.every((v) => typeof v === "string")
  )
    throw new Error("The result did not match the expected format. Try again.");
  const width = r.headers.length;
  if (
    r.kind === "table" &&
    (!width || r.rows.some((row) => (row as string[]).length !== width))
  )
    throw new Error("The table has inconsistent columns. Try a clearer crop.");
  return r as unknown as Omit<PasteResult, "actionId" | "source" | "elapsedMs">;
}
