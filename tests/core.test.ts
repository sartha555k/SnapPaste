import test from "node:test";
import assert from "node:assert/strict";
import { chooseContextActions, localCategory } from "../src/shared/actions";
import {
  clipboardPayload,
  markdownHtml,
  safeCell,
  validateResult,
} from "../src/shared/format";
import { combineScreenshotText } from "../src/shared/paste-together";
import type { PasteResult } from "../src/shared/types";

test("spreadsheet output preserves cells and carries a real HTML table", () => {
  const result: PasteResult = {
    kind: "table",
    actionId: "spreadsheet",
    text: "",
    headers: ["Product", "Price"],
    rows: [
      ["A&B", "$12"],
      ["<script>", "-5"],
    ],
    notes: [],
    source: "OpenAI",
    elapsedMs: 1,
  };
  const output = clipboardPayload(result);
  assert.equal(output.text, "Product\tPrice\nA&B\t$12\n<script>\t-5");
  assert.match(output.html, /<th[^>]*>Product<\/th>/);
  assert.match(output.html, /A&amp;B/);
  assert.doesNotMatch(output.html, /<script>/);
});
test("rich paste preserves punctuation and emoji under a legacy HTML decoder", () => {
  const text = "Job hunt update 👀 Apple’s hiring — ₹500 💰";
  const result: PasteResult = {
    kind: "text",
    actionId: "custom",
    text,
    headers: [],
    rows: [],
    notes: [],
    source: "OpenAI",
    elapsedMs: 1,
  };
  const output = clipboardPayload(result);
  assert.equal(output.text, text);
  const decodedHtml = new TextDecoder("windows-1252").decode(
    new TextEncoder().encode(output.html),
  );
  assert.equal(
    decodedHtml,
    "<p>Job hunt update &#128064; Apple&#8217;s hiring &#8212; &#8377;500 &#128176;</p>",
  );
});
test("screenshot content cannot become executable spreadsheet formulas", () => {
  for (const value of [
    '=HYPERLINK("bad")',
    "+SUM(A1:A2)",
    "@SUM(A1)",
    "-cmd",
    "  =1+1",
  ])
    assert.equal(safeCell(value), `'${value}`);
  assert.equal(safeCell("-12.50"), "-12.50");
  assert.equal(safeCell("$12"), "$12");
  assert.equal(safeCell("hello\tworld\nagain"), "hello world again");
});
test("reject inconsistent or invalid model tables before they reach clipboard", () => {
  assert.throws(
    () =>
      validateResult({
        kind: "table",
        text: "",
        headers: ["A", "B"],
        rows: [["one"]],
        notes: [],
      }),
    /inconsistent/,
  );
  assert.throws(
    () =>
      validateResult({
        kind: "text",
        text: 42,
        headers: [],
        rows: [],
        notes: [],
      }),
    /expected format/,
  );
  assert.deepEqual(
    validateResult({
      kind: "table",
      text: "",
      headers: ["Price"],
      rows: [[""]],
      notes: ["Unclear price"],
    }).rows,
    [[""]],
  );
});
test("action selection scopes rankings to the category and keeps only text fixed", () => {
  const actions = chooseContextActions("table", {
    text: 1,
    formatted: 1,
    spreadsheet: 0.95,
    summary: 0.8,
    message: 0.2,
    "bug-report": Number.NaN,
  });
  assert.deepEqual(
    actions.map((a) => a.id),
    ["text", "spreadsheet", "table-markdown", "table-json"],
  );
  assert.equal(
    new Set(chooseContextActions("unknown", {}).map((a) => a.id)).size,
    4,
  );
});
test("local fallback recognizes explicit signals without claiming model understanding", () => {
  assert.equal(
    localCategory("TypeError: Cannot read properties of undefined"),
    "code",
  );
  assert.equal(localCategory("Invoice\nSubtotal $10\nTotal $12"), "receipt");
  assert.equal(
    localCategory("Plan\nMonthly price\nStarter $12\nStudio $29\nBusiness $79"),
    "table",
  );
  assert.equal(localCategory(""), "unknown");
});
test("formatted paste supports headings and code without allowing source HTML", () => {
  const html = markdownHtml(
    "# Error\n- **Visible issue**\n```js\n<script>alert(1)</script>\n```",
  );
  assert.match(html, /<h1>Error<\/h1>/);
  assert.match(html, /<strong>Visible issue<\/strong>/);
  assert.match(html, /<pre><code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("multi-screenshot text keeps selection order and marks an unreadable capture", () => {
  const result = combineScreenshotText([
    { ocrText: "Current: 084" },
    { ocrText: " " },
    { ocrText: "Previous: 079" },
  ]);
  assert.equal(result.source, "Apple Vision");
  assert.equal(
    clipboardPayload(result).text,
    "Screenshot 1\nCurrent: 084\n\nScreenshot 2\n[No readable text]\n\nScreenshot 3\nPrevious: 079",
  );
  assert.throws(
    () => combineScreenshotText([{ ocrText: " " }, { ocrText: "" }]),
    /No readable text/,
  );
});
