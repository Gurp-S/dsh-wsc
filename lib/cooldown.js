/**
 * Per-session decline cooldown.
 *
 * A failed compaction leaves the history untouched; retrying automatically on
 * the very next step would spend the same request against the same failure.
 * The cooldown lets one automatic retry window pass, while a manual
 * compact_context request always goes through.
 */
export class Cooldown {
  #until = new WeakMap()

  active(key, now = Date.now()) {
    const until = this.#until.get(key)
    return Number.isFinite(until) && until > now
  }

  block(key, ms, now = Date.now()) {
    if (!(ms > 0)) return
    this.#until.set(key, now + ms)
  }

  clear(key) {
    this.#until.delete(key)
  }

  remaining(key, now = Date.now()) {
    const until = this.#until.get(key)
    if (!Number.isFinite(until)) return 0
    return Math.max(0, until - now)
  }
}
