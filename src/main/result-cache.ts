import type { PasteResult } from "../shared/types";

/** Shares prefetched and clicked work. Failed requests never poison a later retry. */
export class ResultCache {
  private ready = new Map<string, PasteResult>();
  private running = new Map<string, Promise<PasteResult>>();
  private generation = 0;
  get(key: string, work: () => Promise<PasteResult>) {
    const ready = this.ready.get(key);
    if (ready) return Promise.resolve(ready);
    const running = this.running.get(key);
    if (running) return running;
    const generation = this.generation;
    const result = Promise.resolve()
      .then(work)
      .then((value) => {
        if (generation === this.generation) this.ready.set(key, value);
        while (this.ready.size > 20)
          this.ready.delete(this.ready.keys().next().value!);
        return value;
      })
      .finally(() => {
        if (this.running.get(key) === result) this.running.delete(key);
      });
    this.running.set(key, result);
    return result;
  }
  has(key: string) {
    return this.ready.has(key);
  }
  isRunning(key: string) {
    return this.running.has(key);
  }
  clear() {
    this.generation++;
    this.ready.clear();
    this.running.clear();
  }
}
