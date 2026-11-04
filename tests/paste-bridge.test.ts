import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { NativePaste } from "../src/main/native-paste";
const directory = path.resolve("native/bin");
test(
  "native paste binding loads in process and rejects a stale target without sending a paste",
  {
    skip:
      process.platform !== "darwin" ||
      !existsSync(path.join(directory, "SnapPasteNative.node")),
  },
  async () => {
    const native = new NativePaste(directory, process.pid);
    const status = await native.request("status");
    assert.equal(typeof status.trusted, "boolean");
    const stale = await native.paste(-1, {
      text: "must not be pasted",
      html: "",
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale-target");
  },
);
