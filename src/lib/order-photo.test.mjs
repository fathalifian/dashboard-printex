import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('./order-photo.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
new Function('exports', source)(exports)
const { orderPhotoExtension, MAX_ORDER_PHOTO_SIZE } = exports

test('optional photo validation accepts supported images up to 5 MB', () => {
  for (const [type, extension] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]) {
    assert.equal(orderPhotoExtension({ type, size: MAX_ORDER_PHOTO_SIZE }), extension)
  }
  assert.throws(() => orderPhotoExtension({ type: 'image/png', size: 0 }), /kosong/)
  assert.throws(() => orderPhotoExtension({ type: 'image/jpeg', size: MAX_ORDER_PHOTO_SIZE + 1 }), /maksimal/)
  for (const type of ['image/svg+xml', 'text/html', '', 'application/pdf']) assert.throws(() => orderPhotoExtension({ type, size: 100 }), /JPG/)
})
