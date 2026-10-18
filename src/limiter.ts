// Concurrency cap plus a minimum gap between starts. Instagram throttles
// anonymous clients quickly, so lookups go out a couple at a time.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Limiter {
  private active = 0;
  private lastStart = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly gapMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    const wait = this.lastStart + this.gapMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.gapMs);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
