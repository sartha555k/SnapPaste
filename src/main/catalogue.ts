import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import seed from "../shared/catalogue-seed.json";
import { validateCatalogue, type Catalogue } from "../shared/catalogue";

// Publishable client configuration only. Never use a secret/service-role key here.
export const catalogueConfig = {
  url: "https://xmidgglufudzngrnozmg.supabase.co",
  key: "sb_publishable_3k8E9eHpsPcR87Ehm9ap6w_tpzfGbG_",
};
export class CatalogueStore {
  data = validateCatalogue(seed);
  source = "bundled";
  fetchedAt: string | null = null;
  error: string | undefined;
  private running?: Promise<void>;
  constructor(
    private file: string,
    private request: typeof fetch = fetch,
  ) {}
  get version() {
    return createHash("sha256")
      .update(JSON.stringify(this.data))
      .digest("hex")
      .slice(0, 16);
  }
  status() {
    return {
      source: this.source,
      categories: this.data.categories.length,
      subcategories: this.data.subcategories.length,
      fetchedAt: this.fetchedAt,
      error: this.error,
    };
  }
  async open() {
    try {
      const cached = JSON.parse(await readFile(this.file, "utf8"));
      this.data = validateCatalogue(cached.data);
      this.fetchedAt =
        typeof cached.fetchedAt === "string" ? cached.fetchedAt : null;
      this.source = "cache";
    } catch {
      /* First launch or corrupt cache: the bundled catalogue remains usable. */
    }
  }
  refresh(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.download().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async download() {
    try {
      const read = async (table: string, order: string) => {
        const rows: unknown[] = [];
        for (let offset = 0; offset < 10000; offset += 1000) {
          const response = await this.request(
            `${catalogueConfig.url}/rest/v1/${table}?select=*&order=${order}&limit=1000&offset=${offset}`,
            {
              headers: { apikey: catalogueConfig.key },
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!response.ok)
            throw new Error(`Menu sync failed (${response.status}).`);
          const page = await response.json();
          if (!Array.isArray(page))
            throw new Error("Invalid menu sync response.");
          rows.push(...page);
          if (page.length < 1000) return rows;
        }
        throw new Error("Menu catalogue exceeds the sync limit.");
      };
      const [categories, subcategories, actions, mappings] = await Promise.all([
        read("categories", "id"),
        read("subcategories", "id"),
        read("actions", "id"),
        read("subcategory_actions", "subcategory_id,position"),
      ]);
      const data = validateCatalogue({
        categories,
        subcategories,
        actions,
        mappings,
      });
      const fetchedAt = new Date().toISOString();
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify({ data, fetchedAt }), {
        mode: 0o600,
      });
      await rename(`${this.file}.tmp`, this.file);
      this.data = data;
      this.fetchedAt = fetchedAt;
      this.source = "supabase";
      this.error = undefined;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Menu sync unavailable.";
      // Last known good definitions stay in place. No partial remote catalogue is used.
    }
  }
}
