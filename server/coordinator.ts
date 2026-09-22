export class QueueFullError extends Error {
  readonly code = "QUEUE_FULL";

  constructor() {
    super("The analysis queue is full.");
    this.name = "QueueFullError";
  }
}

export class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    readonly limit: number,
    readonly maxQueue = 8,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Semaphore limit must be a positive integer.");
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new Error("Semaphore queue limit must be a non-negative integer.");
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(new QueueFullError());
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    next?.();
  }
}

interface CacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
  settled: boolean;
}

export class SingleFlightCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    readonly ttlMs = 15_000,
    private readonly now: () => number = Date.now,
  ) {}

  getOrCreate(key: string, operation: () => Promise<T>): Promise<T> {
    this.prune();
    const existing = this.entries.get(key);
    if (existing && (!existing.settled || existing.expiresAt > this.now())) {
      return existing.promise;
    }

    const promise = operation();
    const entry = { promise, expiresAt: Number.POSITIVE_INFINITY, settled: false };
    this.entries.set(key, entry);
    void promise.then(
      () => {
        if (this.entries.get(key)?.promise !== promise) return;
        entry.settled = true;
        entry.expiresAt = this.now() + this.ttlMs;
      },
      () => {
        if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      },
    );
    return promise;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
