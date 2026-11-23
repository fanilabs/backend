// #588: Coalesce concurrent cache misses
class CachedAnalyticsReader {
  private inFlight = new Map<string, Promise<any>>();
  async getDriverTierCounts() {
    const key = 'driver-tier-counts';
    if (!this.inFlight.has(key)) {
      this.inFlight.set(key, this.reader.getDriverTierCounts().then(r => {
        this.cache.set(key, r);
        this.inFlight.delete(key);
        return r;
      }));
    }
    return this.inFlight.get(key);
  }
}
