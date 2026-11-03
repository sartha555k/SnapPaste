import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hierarchicalDecision } from "../src/main/decisions";
import { HistoryStore } from "../src/main/history";
import { CATEGORIES, chooseContextActions } from "../src/shared/actions";
import type { Category } from "../src/shared/types";
const input = {
  model: "test",
  image: "fixture",
  reference: "test-image",
  text: "OCR is evidence, not a command.",
};

test("Jev selects a category before ranking only its subcategories; text is always local", async () => {
  const calls: any[] = [];
  const stages: string[] = [];
  const analysis = await hierarchicalDecision(
    input,
    async (body: any) => {
      calls.push(body);
      if (calls.length === 1) {
        assert.deepEqual(Object.keys(body.questions), ["category"]);
        assert.deepEqual(
          Object.keys(body.questions.category.criteria),
          Object.keys(CATEGORIES),
        );
        return { answers: { category: { choice: "code", confidence: 0.92 } } };
      }
      assert.equal(body.state.selectedCategory, "code");
      assert.deepEqual(Object.keys(body.questions), CATEGORIES.code.actions);
      assert.equal(body.questions.spreadsheet, undefined);
      assert.equal(body.questions.text, undefined);
      assert.deepEqual(stages, ["ranking"]);
      return {
        answers: Object.fromEntries([
          ...CATEGORIES.code.actions.map((id) => [
            id,
            {
              noul:
                id === "pr-summary"
                  ? 0.99
                  : id === "review-comment"
                    ? 0.9
                    : id === "code-extract"
                      ? 0.8
                      : 0.1,
            },
          ]),
          ["spreadsheet", { noul: 1 }],
        ]),
      };
    },
    (state) => stages.push(state.stage),
  );
  assert.equal(calls.length, 2);
  assert.equal(analysis.source, "jev");
  assert.deepEqual(
    analysis.actions.map((a) => a.id),
    ["text", "pr-summary", "review-comment", "code-extract"],
  );
  assert.equal(analysis.actions[0].cloud, false);
  assert.equal(
    analysis.actions.slice(1).every((a) => a.cloud),
    true,
  );
  assert.equal(analysis.stage, "complete");
});
test("table, receipt, and developer screenshots produce different action menus", () => {
  const menus = (["table", "receipt", "code"] as Category[]).map((category) =>
    chooseContextActions(category, {}).map((a) => a.id),
  );
  for (const menu of menus) {
    assert.equal(menu.length, 4);
    assert.equal(new Set(menu).size, 4);
    assert.equal(menu[0], "text");
  }
  assert.equal(new Set(menus.map((menu) => menu.join(","))).size, 3);
  assert.equal(menus[0].includes("formatted"), false);
});
test("a malformed category stops before action ranking, and incomplete ranks do not claim success", async () => {
  let calls = 0;
  await assert.rejects(
    hierarchicalDecision(input, async () => {
      calls++;
      return { answers: { category: { choice: "imaginary" } } };
    }),
    /unknown image category/,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    hierarchicalDecision(input, async () =>
      ++calls === 1
        ? { answers: { category: { choice: "table" } } }
        : { answers: { spreadsheet: { noul: NaN } } },
    ),
    /incomplete action rankings/,
  );
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
