export type CacheHit = { at: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-pill': { hit: CacheHit | null; now: number; ttlMs: number | null }
  }
}
