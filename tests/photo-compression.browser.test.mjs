import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import ts from 'typescript'

test('browser compresses real images to WebP, preserves aspect ratio and transparency, and rejects corrupt images', async () => {
  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const browser = await chromium.launch({ headless: true, ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}) })
  try {
    const page = await browser.newPage()
    const compiled = ts.transpileModule(readFileSync('src/lib/order-photo.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    await page.addScriptTag({ content: `{const exports={};${compiled};window.photoTools=exports;}` })
    const results = await page.evaluate(async () => {
      const { compressOrderPhoto } = window.photoTools
      const outputs = []
      for (const [width, height, noise] of [[3200, 2000, false], [1800, 3200, false], [400, 300, false], [1600, 1000, true]]) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const ctx = canvas.getContext('2d')
        const gradient = ctx.createLinearGradient(0, 0, width, height)
        gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#f5b5a0')
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height)
        if (noise) {
          const pixels = ctx.getImageData(0, 0, width, height)
          let seed = 12
          for (let i = 0; i < pixels.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            const change = (seed % 33) - 16
            for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] += change
          }
          ctx.putImageData(pixels, 0, 0)
        }
        ctx.fillStyle = '#182230'; ctx.font = 'bold 48px Arial'
        for (let y = 70; y < height; y += 90) ctx.fillText('SPK-1162 / BATIK / 25 meter', 20, y)
        // Transparent corner must survive PNG -> WebP conversion.
        ctx.clearRect(0, 0, 10, 10)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        const file = await compressOrderPhoto(new File([blob], 'order.png', { type: 'image/png' }))
        const bitmap = await createImageBitmap(file)
        const check = document.createElement('canvas'); check.width = bitmap.width; check.height = bitmap.height
        check.getContext('2d').drawImage(bitmap, 0, 0)
        outputs.push({ source: [width, height], size: file.size, type: file.type, name: file.name, width: bitmap.width, height: bitmap.height,
          alpha: check.getContext('2d').getImageData(0, 0, 1, 1).data[3], cached: await compressOrderPhoto(file) === file })
        bitmap.close()
      }
      let corruptError = ''
      try { await compressOrderPhoto(new File(['not an image'], 'fake.jpg', { type: 'image/jpeg' })) } catch (error) { corruptError = error.message }
      return { outputs, corruptError }
    })
    for (const photo of results.outputs) {
      assert.equal(photo.type, 'image/webp'); assert.equal(photo.name, 'order.webp')
      assert.ok(photo.size > 0 && photo.size <= 400 * 1024)
      assert.ok(Math.max(photo.width, photo.height) <= 1600)
      assert.ok(Math.abs(photo.width / photo.height - photo.source[0] / photo.source[1]) < 0.002)
      assert.equal(photo.alpha, 0); assert.equal(photo.cached, true)
    }
    assert.equal(results.outputs[2].width, 400)
    assert.match(results.corruptError, /tidak dapat dibaca/)
    console.log('Compressed image results:', results.outputs.map(({ width, height, size }) => ({ width, height, KB: Math.ceil(size / 1024) })))
  } finally { await browser.close() }
})
