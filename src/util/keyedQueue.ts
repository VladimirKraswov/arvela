/**
 * Serialize mutations that share any resource. Reserve every key synchronously
 * before starting work: two opposite transfers cannot wait on each other.
 * Tasks must not recursively acquire a key they already own.
 */
export class KeyedQueue {
  private pending = new Map<string, Promise<unknown>>();

  run<T>(keys: readonly string[], task: () => Promise<T>): Promise<T> {
    const resources = [...new Set(keys)];
    const previous = resources.map(key => this.pending.get(key)?.catch(() => {}));
    const next = Promise.all(previous).then(task);
    for (const key of resources) this.pending.set(key, next);
    const release = () => {
      for (const key of resources) if (this.pending.get(key) === next) this.pending.delete(key);
    };
    // Observe both outcomes without creating an unhandled rejected cleanup promise.
    void next.then(release, release);
    return next;
  }

  async settled(key: string): Promise<void> {
    await this.pending.get(key);
  }
}
