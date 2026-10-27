/** Fraction of the TTL still left, clamped to [0, 1]. */
export function charge(at: number, ttlMs: number, now: number): number {
  return Math.min(1, Math.max(0, 1 - (now - at) / ttlMs))
}

/** Under this share of the TTL left, the pill turns amber; cache-clock's threshold. */
const WARN_SHARE = 0.2

/** Warm green while the cache is warm, amber near expiry, orange-red when cold. */
export function pillColor(fraction: number): string {
  if (fraction <= 0) return '#d9482b'

  return fraction < WARN_SHARE ? '#e0a800' : '#7cb342'
}

/** Whole minutes left, rounded up, so the label reads `1m left` until the cache expires. */
export function formatRemaining(ms: number): string {
  return `${Math.max(0, Math.ceil(ms / 60_000))}m left`
}

/** Swaps 0-9 for the mathematical monospace digits (U+1D7F6..), one advance width each. */
export function monoDigits(text: string): string {
  return text.replace(/[0-9]/g, d => String.fromCodePoint(0x1d7f6 + Number(d)))
}

