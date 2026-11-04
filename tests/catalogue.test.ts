import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import seed from "../src/shared/catalogue-seed.json";
import { validateCatalogue, catalogueAnalysis } from "../src/shared/catalogue";
import { CatalogueStore } from "../src/main/catalogue";
import { localOutput } from "../src/main/local";
import { ResultCache } from "../src/main/result-cache";
import type { Capture, PasteResult } from "../src/shared/types";
const valid = () => validateCatalogue(structuredClone(seed));
function subject(): Capture {
  return {
    id: "test",
    name: "Marksheet",
    dataUrl: "",
    width: 100,
    height: 100,
    bytes: 1,
    ocrText: "Name\nMarks\nA\n12",
    local: {
      text: "",
      values: [{ label: "Email", value: "a@example.com" }],
      tables: [
        {
          simple: true,
          rows: [
            ["Name", "Marks"],
            ["A", "12"],
          ],
        },
      ],
    },
    analysis: catalogueAnalysis(
      valid(),
      "education.marksheet-or-grade-report",
      "v1",
    ),
    phase: "ready",
  };
}

test("complete catalogue has 20 categories, 146 unique menus, and only local text in slot one", () => {
  const c = valid();
  assert.equal(c.categories.length, 20);
  assert.equal(c.subcategories.length, 146);
  assert.equal(c.mappings.length, 584);
  for (const sub of c.subcategories) {
    const menu = catalogueAnalysis(c, sub.id, "v1");
    assert.equal(menu.actions.length, 4);
    assert.equal(menu.actions[0].processor, "local_ocr");
    assert.doesNotMatch(
      menu.actions.map((a) => a.title).join(" "),
      /\b(explain|diagnose|diagnosis|translate|advice)\b/i,
    );
  }
  const broken = valid();
  broken.mappings[0].action_id = "summary";
  assert.throws(() => validateCatalogue(broken), /Invalid menu/);
});

test("failed or partial Supabase sync preserves last good on-disk definitions", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "snappaste-catalogue-"));
  try {
    let calls = 0;
    const store = new CatalogueStore(
      path.join(folder, "definitions.json"),
      async (url, options) => {
        calls++;
        assert.equal(
          (options?.headers as Record<string, string>).apikey.startsWith(
            "sb_publishable_",
          ),
          true,
        );
        const key = String(url).split("/rest/v1/")[1].split("?")[0];
        const data =
          key === "subcategory_actions"
            ? seed.mappings
            : seed[key as "actions" | "categories" | "subcategories"];
        return new Response(JSON.stringify(data), { status: 200 });
      },
    );
    await store.open();
    await store.refresh();
    assert.equal(calls, 4);
    assert.equal(store.source, "supabase");
    const saved = await readFile(path.join(folder, "definitions.json"), "utf8");
    const offline = new CatalogueStore(
      path.join(folder, "definitions.json"),
      async () => {
        throw new Error("offline");
      },
    );
    await offline.open();
    const version = offline.version;
    await offline.refresh();
    assert.equal(offline.source, "cache");
    assert.equal(offline.version, version);
    assert.equal(offline.error, "offline");
    assert.equal(
      await readFile(path.join(folder, "definitions.json"), "utf8"),
      saved,
    );
    const partial = new CatalogueStore(
      path.join(folder, "definitions.json"),
      async () => new Response("[]"),
    );
    await partial.open();
    await partial.refresh();
    assert.equal(partial.version, version);
    assert.ok(partial.error);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("local tables bypass AI only for one rectangular table with no merged cells", () => {
  const c = subject();
  const action = c.analysis.actions[1];
  const result = localOutput(c, action)!;
  assert.equal(result.source, "Apple Vision");
  assert.equal(result.kind, "table");
  assert.deepEqual(result.rows, [["A", "12"]]);
  c.local!.tables[0].simple = false;
  assert.equal(localOutput(c, action), null);
  c.local!.tables.push({
    simple: true,
    rows: [
      ["X", "Y"],
      ["1", "2"],
    ],
  });
  assert.equal(localOutput(c, action), null);
});

test("value extraction uses a picker and semantic actions never silently become OCR", () => {
  const c = subject();
  c.analysis = catalogueAnalysis(valid(), "contacts.business-card", "v1");
  const value = localOutput(
    c,
    c.analysis.actions.find((a) => a.id === "values")!,
  )!;
  assert.deepEqual(value.values, [{ label: "Email", value: "a@example.com" }]);
  assert.equal(
    localOutput(
      c,
      c.analysis.actions.find((a) => a.id === "contact")!,
    ),
    null,
  );
});

test("a click shares the in-flight option-2 request and failed work can retry", async () => {
  const cache = new ResultCache();
  let calls = 0;
  let finish!: (result: PasteResult) => void;
  const work = () => {
    calls++;
    return new Promise<PasteResult>((resolve) => {
      finish = resolve;
    });
  };
  const prefetch = cache.get("a", work);
  const click = cache.get("a", work);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({
    actionId: "text",
    kind: "text",
    text: "ready",
    headers: [],
    rows: [],
    notes: [],
    source: "Apple Vision",
    elapsedMs: 1,
  });
  assert.deepEqual(await prefetch, await click);
  await cache.get("a", work);
  assert.equal(calls, 1);
  await assert.rejects(
    cache.get("b", async () => {
      throw new Error("offline");
    }),
  );
  const retried = await cache.get("b", async () => ({
    ...(await prefetch),
    text: "retry",
  }));
  assert.equal(retried.text, "retry");
});

test("settings invalidation prevents an old in-flight result repopulating the output cache", async () => {
  const cache = new ResultCache();
  let finish!: (value: PasteResult) => void;
  const old = cache.get(
    "same-key",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  cache.clear();
  const result: PasteResult = {
    actionId: "text",
    kind: "text",
    text: "old",
    headers: [],
    rows: [],
    notes: [],
    source: "Apple Vision",
    elapsedMs: 0,
  };
  finish(result);
  await old;
  assert.equal(cache.has("same-key"), false);
  const fresh = await cache.get("same-key", async () => ({
    ...result,
    text: "new",
  }));
  assert.equal(fresh.text, "new");
});
