/**
 * In-process sliding-window limiter. It only coordinates calls made through
 * one adapter instance (one serverless instance), so it smooths bursts such as
 * parallel MCP tool calls; it is not a distributed quota.
 */
export interface SlidingWindowOptions {
  /** Maximum calls per window. */
  limit: number;
  windowMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SlidingWindowLimiter {
  private readonly stamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SlidingWindowOptions) {
    this.limit = Math.max(1, Math.floor(options.limit));
    this.windowMs = Math.max(1, options.windowMs);
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Milliseconds until a slot is free (0 when one is free now). */
  waitTime(): number {
    const now = this.now();
    while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) >= this.windowMs) this.stamps.shift();
    if (this.stamps.length < this.limit) return 0;
    return Math.max(0, (this.stamps[0] ?? now) + this.windowMs - now);
  }

  /**
   * Take a slot, waiting up to `maxWaitMs` for one to free up. Returns false
   * (without taking a slot) when the wait would be longer.
   */
  async acquire(maxWaitMs = Number.POSITIVE_INFINITY): Promise<boolean> {
    let waited = 0;
    for (;;) {
      const wait = this.waitTime();
      if (wait === 0) {
        this.stamps.push(this.now());
        return true;
      }
      if (waited + wait > maxWaitMs) return false;
      await this.sleep(wait);
      waited += wait;
    }
  }
}
