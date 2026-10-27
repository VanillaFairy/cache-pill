export const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

export type CacheReading = {
  /** TTL of the latest cache write; null when the text holds none. */
  ttlMs: number | null
  /** When the latest main-thread response that touched the cache was recorded. */
  lastAt: number | null
}

type Usage = {
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null
}

type Entry = { type?: string; isSidechain?: boolean; timestamp?: string; message?: { usage?: Usage } }

/**
 * Reads the newest main-thread assistant entries of a transcript (JSONL).
 * A write split across both TTLs reports 5m: the conversation tail written
 * under it is the part that expires first.
 */
export function readCache(jsonl: string): CacheReading {
  const lines = jsonl.split('\n')
  let ttlMs: number | null = null
  let lastAt: number | null = null

  for (let i = lines.length - 1; i >= 0 && ttlMs === null; i--) {
    const line = lines[i]!
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue
    let entry: Entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const usage = entry.message?.usage
    if (entry.type !== 'assistant' || entry.isSidechain || !usage) continue

    const touched = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    if (lastAt === null && touched > 0 && entry.timestamp) {
      lastAt = Date.parse(entry.timestamp)
    }
    const split = usage.cache_creation
    if ((split?.ephemeral_5m_input_tokens ?? 0) > 0) ttlMs = TTL_MS['5m']
    else if ((split?.ephemeral_1h_input_tokens ?? 0) > 0) ttlMs = TTL_MS['1h']
  }

  return { ttlMs, lastAt }
}
