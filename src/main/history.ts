import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { HistoryItem, HistoryPage } from "../shared/types";

interface Entry extends Omit<HistoryItem, "thumbnail"> {
  hash: string;
  thumbnailBytes: number;
}
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
export class HistoryStore {
  private entries: Entry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private limit: number,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private imagePath(id: string) {
    if (!validId(id)) throw new Error("Invalid screenshot ID.");
    return path.join(this.root, `${id}.png`);
  }
  private thumbPath(id: string) {
    if (!validId(id)) throw new Error("Invalid screenshot ID.");
    return path.join(this.root, `${id}.thumb.png`);
  }
  async open() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(
        await readFile(path.join(this.root, "index.json"), "utf8"),
      );
      if (Array.isArray(parsed))
        this.entries = parsed.filter(
          (e: Entry) =>
            validId(e.id) &&
            typeof e.name === "string" &&
            typeof e.createdAt === "string" &&
            Number.isFinite(e.bytes) &&
            e.bytes > 0 &&
            Number.isFinite(e.thumbnailBytes) &&
            e.thumbnailBytes >= 0,
        );
    } catch {
      /* A new history starts with no index. Never scan unrelated files. */
    }
    const restored = await Promise.all(
      this.entries.map(async (entry) => {
        try {
          await Promise.all([
            access(this.imagePath(entry.id)),
            access(this.thumbPath(entry.id)),
          ]);
          return entry;
        } catch {
          return null;
        }
      }),
    );
    this.entries = restored.filter((entry): entry is Entry => entry !== null);
    await this.prune();
  }
  private async persist() {
    const index = path.join(this.root, "index.json");
    await writeFile(`${index}.tmp`, JSON.stringify(this.entries), {
      mode: 0o600,
    });
    await rename(`${index}.tmp`, index);
  }
  private used() {
    return this.entries.reduce(
      (total, e) => total + e.bytes + e.thumbnailBytes,
      0,
    );
  }
  private async prune() {
    while (this.used() > this.limit && this.entries.length) {
      const old = this.entries.pop()!;
      await Promise.all([
        rm(this.imagePath(old.id), { force: true }),
        rm(this.thumbPath(old.id), { force: true }),
      ]);
    }
    await this.persist();
  }
  setLimit(bytes: number) {
    return this.serial(async () => {
      this.limit = bytes;
      await this.prune();
    });
  }
  add(
    image: Buffer,
    thumbnail: Buffer,
    meta: { name: string; width: number; height: number },
  ): Promise<HistoryItem> {
    return this.serial(async () => {
      if (image.length + thumbnail.length > this.limit)
        throw new Error(
          "This screenshot exceeds the history storage budget. Increase the limit or capture a smaller region.",
        );
      const hash = createHash("sha256").update(image).digest("hex");
      const existing = this.entries.find((e) => e.hash === hash);
      if (existing) {
        existing.createdAt = new Date().toISOString();
        this.entries = [
          existing,
          ...this.entries.filter((e) => e.id !== existing.id),
        ];
        await this.persist();
        return {
          ...existing,
          thumbnail: `data:image/png;base64,${thumbnail.toString("base64")}`,
        };
      }
      const entry: Entry = {
        id: randomUUID(),
        hash,
        ...meta,
        bytes: image.length,
        thumbnailBytes: thumbnail.length,
        createdAt: new Date().toISOString(),
      };
      await writeFile(this.imagePath(entry.id), image, { mode: 0o600 });
      await writeFile(this.thumbPath(entry.id), thumbnail, { mode: 0o600 });
      this.entries.unshift(entry);
      await this.prune();
      return {
        ...entry,
        thumbnail: `data:image/png;base64,${thumbnail.toString("base64")}`,
      };
    });
  }
  async list(offset = 0, count = 40): Promise<HistoryPage> {
    await this.queue;
    offset = Math.max(0, Math.floor(offset));
    const selected = this.entries.slice(offset, offset + count);
    const items = await Promise.all(
      selected.map(
        async ({ hash: _hash, thumbnailBytes: _size, ...entry }) => ({
          ...entry,
          thumbnail: `data:image/png;base64,${(await readFile(this.thumbPath(entry.id)).catch(() => Buffer.alloc(0))).toString("base64")}`,
        }),
      ),
    );
    return {
      items,
      total: this.entries.length,
      bytes: this.used(),
      limitBytes: this.limit,
      hasMore: offset + selected.length < this.entries.length,
    };
  }
  async get(id: string): Promise<{ item: HistoryItem; image: Buffer }> {
    await this.queue;
    const entry = this.entries.find((e) => e.id === id);
    if (!entry)
      throw new Error(
        "That screenshot is no longer in history. It may have aged out of the storage budget.",
      );
    return {
      item: { ...entry, thumbnail: "" },
      image: await readFile(this.imagePath(id)),
    };
  }
}
