'use client'

import { createClient } from './supabase/client'
import { ORDER_PHOTO_BUCKET } from './order-photo'
import { createPhotoUrlCache } from './photo-url-cache'

const cache = createPhotoUrlCache(async path => {
  const { data, error } = await createClient().storage.from(ORDER_PHOTO_BUCKET).createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
})
let listening = false
export function getOrderPhotoUrl(path: string) {
  if (!listening) {
    listening = true
    let user: string | undefined
    createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id
      if (user !== next) cache.clear()
      user = next
    })
  }
  return cache.get(path)
}
export const invalidateOrderPhotoUrl = (path: string) => cache.invalidate(path)
