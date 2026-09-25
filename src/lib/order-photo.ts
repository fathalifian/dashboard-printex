export const ORDER_PHOTO_BUCKET = 'order-photos'
export const MAX_ORDER_PHOTO_SIZE = 5 * 1024 * 1024
export const ORDER_PHOTO_MAX_EDGE = 1600
export const ORDER_PHOTO_TARGET_SIZE = 400 * 1024
const compressedPhotos = new WeakSet<File>()
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export function orderPhotoExtension(file: { type: string; size: number }) {
  const extension = Object.hasOwn(EXTENSIONS, file.type) ? EXTENSIONS[file.type] : undefined
  if (!extension) throw new Error('Pilih foto JPG, PNG, atau WebP.')
  if (file.size <= 0) throw new Error('File foto kosong. Pilih foto lain.')
  if (file.size > MAX_ORDER_PHOTO_SIZE) throw new Error('Ukuran foto maksimal 5 MB.')
  return extension
}

export function photoDimensions(width: number, height: number) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) throw new Error('Dimensi foto tidak valid.')
  const scale = Math.min(1, ORDER_PHOTO_MAX_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function compressOrderPhoto(file: File): Promise<File> {
  orderPhotoExtension(file)
  if (compressedPhotos.has(file)) return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('Foto tidak dapat dibaca. Pilih file JPG, PNG, atau WebP yang valid.') }
  const canvas = document.createElement('canvas')
  try {
    const dimensions = photoDimensions(bitmap.width, bitmap.height)
    canvas.width = dimensions.width; canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Browser tidak dapat memproses foto. Coba browser lain.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob || blob.type !== 'image/webp') reject(new Error('Browser belum mendukung kompresi WebP. Gunakan browser terbaru.'))
        else resolve(blob)
      }, 'image/webp', quality)
    })
    // Preserve dimensions and text detail: use the highest quality that fits.
    // Small/simple images may be below 200 KB; do not pad or upscale them.
    let result = await encode(0.92)
    if (result.size > ORDER_PHOTO_TARGET_SIZE) {
      let low = 0.72, high = 0.92
      result = await encode(low)
      if (result.size > ORDER_PHOTO_TARGET_SIZE) throw new Error('Foto terlalu kompleks untuk diperkecil tanpa mengurangi detail. Potong area yang tidak diperlukan lalu pilih kembali.')
      for (let attempt = 0; attempt < 5; attempt++) {
        const quality = (low + high) / 2
        const candidate = await encode(quality)
        if (candidate.size <= ORDER_PHOTO_TARGET_SIZE) { result = candidate; low = quality }
        else high = quality
      }
    }
    const compressed = new File([result], `${file.name.replace(/\.[^.]+$/, '') || 'foto-order'}.webp`, { type: 'image/webp' })
    compressedPhotos.add(compressed)
    return compressed
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0 }
}
