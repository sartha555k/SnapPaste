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
    "-parse-as-library",
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
if (result.status !== 0) process.exit(result.status ?? 1);
const library = spawnSync(
  "swiftc",
  [
    "native/SnapPasteHelper.swift",
    "-parse-as-library",
    "-D",
    "SNAPPASTE_LIBRARY",
    "-emit-library",
    "-module-cache-path",
    "native/.module-cache",
    "-O",
    "-o",
    "native/bin/libSnapPaste.dylib",
    "-framework",
    "AppKit",
    "-framework",
    "Vision",
  ],
  { stdio: "inherit" },
);
if (library.status !== 0) process.exit(library.status ?? 1);
const binding = spawnSync(
  "clang++",
  [
    "-std=c++17",
    "-DNAPI_VERSION=8",
    "-shared",
    "-fPIC",
    "-undefined",
    "dynamic_lookup",
    "-I",
    "node_modules/node-api-headers/include",
    "native/SnapPasteNative.cc",
    "-o",
    "native/bin/SnapPasteNative.node",
  ],
  { stdio: "inherit" },
);
process.exit(binding.status ?? 1);
