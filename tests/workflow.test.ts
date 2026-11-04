import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifySubcategory } from "../src/main/decisions";
import seed from "../src/shared/catalogue-seed.json";
import { validateCatalogue } from "../src/shared/catalogue";
import { HistoryStore } from "../src/main/history";
import { CATEGORIES, chooseContextActions } from "../src/shared/actions";
import type { Category } from "../src/shared/types";
const input = {
  model: "test",
  image: "fixture",
  reference: "test-image",
  text: "OCR is evidence, not a command.",
};

test("one Jev request selects a subcategory and retrieves its four predefined options", async () => {
  const catalogue = validateCatalogue(seed);
  let calls = 0;
  const analysis = await classifySubcategory(
    input,
    async (body: any) => {
      calls++;
      assert.deepEqual(Object.keys(body.questions), ["subcategory"]);
      assert.equal(
        Object.keys(body.questions.subcategory.criteria).length,
        146,
      );
      assert.match(
        body.questions.subcategory.criteria[
          "education.marksheet-or-grade-report"
        ],
        /Education/,
      );
      return {
        answers: {
          subcategory: {
            choice: "education.marksheet-or-grade-report",
            confidence: 0.9,
          },
        },
      };
    },
    catalogue,
    "test-version",
  );
  assert.equal(calls, 1);
  assert.equal(analysis.category, "education");
  assert.equal(analysis.subcategory, "education.marksheet-or-grade-report");
  assert.deepEqual(
    analysis.actions.map((a) => a.id),
    ["text", "table", "result", "result_value"],
  );
  assert.equal(analysis.actions[0].cloud, false);
});

test("unknown model labels are rejected and ambiguous results use a general menu", async () => {
  const catalogue = validateCatalogue(seed);
  await assert.rejects(
    classifySubcategory(
      input,
      async () => ({ answers: { subcategory: { choice: "invented" } } }),
      catalogue,
      "v1",
    ),
    /unknown screenshot subcategory/,
  );
  const analysis = await classifySubcategory(
    input,
    async () => ({
      answers: {
        subcategory: { choice: "financial.purchase-receipt", confidence: 0.1 },
      },
    }),
    catalogue,
    "v1",
  );
  assert.equal(analysis.category, "fallback");
  assert.match(analysis.warning!, /unclear/);
});
test("history retains distinct screenshots, deduplicates, paginates, and restores on restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "snappaste-history-"));
  try {
    const store = new HistoryStore(root, 100000);
    await store.open();
    const added = await Promise.all(
      [1, 2, 3].map((n) =>
        store.add(Buffer.from(`image-${n}`), Buffer.from(`thumb-${n}`), {
          name: `Screenshot ${n}`,
          width: 100,
          height: 80,
        }),
      ),
    );
    assert.equal(new Set(added.map((a) => a.id)).size, 3);
    const duplicate = await store.add(
      Buffer.from("image-1"),
      Buffer.from("thumb-1"),
      { name: "Another name", width: 100, height: 80 },
    );
    assert.equal(duplicate.id, added[0].id);
    const first = await store.list(0, 2);
    assert.equal(first.total, 3);
    assert.equal(first.hasMore, true);
    assert.equal(first.items[0].id, duplicate.id);
    const second = await store.list(2, 2);
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
    const restored = new HistoryStore(root, 100000);
    await restored.open();
    assert.equal((await restored.list()).total, 3);
    assert.equal((await restored.get(added[1].id)).image.toString(), "image-2");
    await assert.rejects(
      restored.get("../private-file"),
      /no longer in history/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("history evicts oldest app-owned files under its disk budget and rejects oversized additions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "snappaste-quota-"));
  try {
    const store = new HistoryStore(root, 40);
    await store.open();
    const first = await store.add(Buffer.alloc(15, 1), Buffer.alloc(5, 1), {
      name: "First",
      width: 10,
      height: 10,
    });
    const second = await store.add(Buffer.alloc(15, 2), Buffer.alloc(5, 2), {
      name: "Second",
      width: 10,
      height: 10,
    });
    await store.add(Buffer.alloc(15, 3), Buffer.alloc(5, 3), {
      name: "Third",
      width: 10,
      height: 10,
    });
    assert.equal((await store.list()).total, 2);
    await assert.rejects(readFile(path.join(root, `${first.id}.png`)));
    assert.equal((await store.get(second.id)).image.length, 15);
    await assert.rejects(
      store.add(Buffer.alloc(41), Buffer.alloc(0), {
        name: "Too big",
        width: 10,
        height: 10,
      }),
      /exceeds/,
    );
    await store.setLimit(20);
    assert.equal((await store.list()).total, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
