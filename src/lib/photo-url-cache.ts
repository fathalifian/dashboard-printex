type PhotoUrl = { url: string; expiresAt: number }

// Memory-only: concurrent cards share one signing request and browser-cache URL.
export function createPhotoUrlCache(sign: (path: string) => Promise<string>, now = Date.now) {
  const entries = new Map<string, { value?: PhotoUrl; pending?: Promise<PhotoUrl> }>()
  return {
    clear() { entries.clear() },
    invalidate(path: string) { entries.delete(path) },
    get(path: string): Promise<PhotoUrl> {
      const existing = entries.get(path)
      if (existing?.pending) return existing.pending
      if (existing?.value && existing.value.expiresAt > now()) return Promise.resolve(existing.value)
      const entry: { value?: PhotoUrl; pending?: Promise<PhotoUrl> } = {}
      const expiresAt = now() + 9 * 60 * 1000
      entry.pending = sign(path).then(url => {
        if (!url) throw new Error('Foto belum dapat dimuat.')
        const value = { url, expiresAt }
        entry.value = value; entry.pending = undefined
        return value
      }).catch(error => { if (entries.get(path) === entry) entries.delete(path); throw error })
      entries.set(path, entry)
      if (entries.size > 256) {
        for (const [key, item] of entries) {
          if (key !== path && !item.pending) { entries.delete(key); break }
        }
      }
      return entry.pending
    },
  }
}
