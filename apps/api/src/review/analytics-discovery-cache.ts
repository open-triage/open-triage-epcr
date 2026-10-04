/** Bounded, process-local discovery cache. Authorization must happen before lookup. */
export class AnalyticsDiscoveryCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<T> }>();

  constructor(private readonly capacity = 100, private readonly ttlMs = 30_000) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [entryKey, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(entryKey);
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    // Start the TTL before loading, so a slow request cannot extend stale discovery.
    const entry = { expiresAt: now + this.ttlMs, value: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
    void entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.value;
  }
}
