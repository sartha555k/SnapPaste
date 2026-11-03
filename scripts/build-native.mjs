import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (process.platform !== "darwin") {
  console.error("SnapPaste currently supports macOS only.");
  process.exit(1);
}
mkdirSync("native/bin", { recursive: true });
mkdirSync("native/.module-cache", { recursive: true });
const result = spawnSync(
  "swiftc",
  [
    "native/SnapPasteHelper.swift",
    "-module-cache-path",
    "native/.module-cache",
    "-o",
    "native/bin/SnapPasteHelper",
    "-O",
    "-framework",
    "AppKit",
    "-framework",
    "Vision",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
