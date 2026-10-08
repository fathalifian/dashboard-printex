type Entry = { value: string; expires: number; bytes: number }
type Options = { now?: () => number; maxBytes?: number; maxEntries?: number; ttl?: number }

export function createQueryGate(limit = 8) {
  let active = 0
  return async function run<T>(query: () => Promise<T>, overloaded: () => Error): Promise<T> {
    if (active >= limit) throw overloaded()
    active++
    try { return await query() }
    finally { active-- }
  }
}

// A small per-process LRU; optional Redis shares completed summaries across instances.
export function createReportCache({ now = Date.now, maxBytes = 8 * 1024 * 1024, maxEntries = 128, ttl = 30_000 }: Options = {}) {
  const entries = new Map<string, Entry>()
  const pending = new Map<string, Promise<string>>()
  let bytes = 0
  function remove(key: string) {
    const item = entries.get(key)
    if (item) { bytes -= item.bytes; entries.delete(key) }
  }
  return {
    async read(key: string, load: () => Promise<string>, cacheable: (value: string) => boolean, bypass = false) {
      const item = entries.get(key)
      if (!bypass && item && item.expires > now() && cacheable(item.value)) {
        entries.delete(key); entries.set(key, item)
        return { value: item.value, source: 'memory' }
      }
      remove(key)
      if (!bypass && pending.has(key)) return { value: await pending.get(key)!, source: 'coalesced' }
      const request = load()
      pending.set(key, request)
      try {
        const value = await request
        const size = Buffer.byteLength(value)
        if (pending.get(key) === request && cacheable(value) && size <= maxBytes) {
          remove(key)
          while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value!)
          entries.set(key, { value, expires: now() + ttl, bytes: size }); bytes += size
        }
        return { value, source: 'database' }
      } finally { if (pending.get(key) === request) pending.delete(key) }
    },
  }
}

let redisUnavailableUntil = 0
export async function redisCommand(command: string[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token || redisUnavailableUntil > Date.now()) return null
  try {
    if (new URL(url).protocol !== 'https:') throw new Error('Redis requires HTTPS')
    const response = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), cache: 'no-store', signal: AbortSignal.timeout(750),
    })
    const data = await response.json()
    if (!response.ok || data.error) throw new Error('Redis unavailable')
    return data.result
  } catch {
    // Cache failures must not prevent database reads; briefly stop retrying outages.
    redisUnavailableUntil = Date.now() + 30_000
    return null
  }
}
