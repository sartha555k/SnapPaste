import { createRequire } from "node:module";
import path from "node:path";
export interface PasteContext {
  pid: number;
  app: string;
  token?: number;
  trusted: boolean;
  clipboardChange: number;
  clipboardImage: boolean;
  anchor?: { x: number; y: number; width: number; height: number };
}

/** Run AX and paste in the app process, under SnapPaste's own TCC permission. */
export class NativePaste {
  private binding: { request: (library: string, body: string) => string };
  private library: string;
  constructor(
    directory: string,
    private ownPid: number,
  ) {
    this.binding = createRequire(path.join(directory, "binding.cjs"))(
      path.join(directory, "SnapPasteNative.node"),
    );
    this.library = path.join(directory, "libSnapPaste.dylib");
  }
  async request(
    command: string,
    data: Record<string, unknown> = {},
  ): Promise<any> {
    const value = JSON.parse(
      this.binding.request(
        this.library,
        JSON.stringify({ command, ownPid: this.ownPid, ...data }),
      ),
    );
    if (value.error)
      throw new Error("Could not restore the destination text field.");
    return value;
  }
  capture(): Promise<PasteContext> {
    return this.request("capture");
  }
  paste(token: number, payload: { text: string; html: string }) {
    return this.request("paste", { token, ...payload });
  }
  close() {
    /* Loaded code and retained AX objects are released when the app exits. */
  }
}
