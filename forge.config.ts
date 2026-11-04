import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: "com.snappaste.app",
    appCategoryType: "public.app-category.productivity",
    extraResource: [
      "native/bin/SnapPasteHelper",
      "native/bin/SnapPasteNative.node",
      "native/bin/libSnapPaste.dylib",
    ],
    extendInfo: {
      NSScreenCaptureUsageDescription:
        "SnapPaste captures only the screen region you select to extract and format its contents.",
      NSAccessibilityUsageDescription:
        "SnapPaste returns to your selected app and pastes the result when you choose Paste.",
    },
  },
  makers: [new MakerZIP({}, ["darwin"])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main.ts", config: "vite.main.config.ts", target: "main" },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};
export default config;
