import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/room-navigation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function browser(path) {
  const entries = ['https://printex.test' + path]
  let index = 0
  const events = new EventTarget()
  const window = {
    location: { get href() { return entries[index] } },
    history: {
      pushState(_state, _unused, url) { entries.splice(index + 1); entries.push(String(url)); index++ },
      replaceState(_state, _unused, url) { entries[index] = String(url) },
      back() { if (index) index--; events.dispatchEvent(new Event('popstate')) },
      forward() { if (index < entries.length - 1) index++; events.dispatchEvent(new Event('popstate')) },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  }
  const exports = {}
  runInNewContext(source, { exports, require: () => ({}), window, URL, Event })
  return { window, entries, navigate: exports.recordRoomNavigation }
}
test('Back and Forward restore the board room without leaving the board page', () => {
  const { window, entries, navigate } = browser('/schedule')
  navigate(null, null, true)
  navigate('demak')
  navigate('salatiga')
  assert.equal(entries.length, 3)
  window.history.back()
  assert.equal(window.location.href, 'https://printex.test/schedule?branch=demak')
  window.history.back()
  assert.equal(window.location.href, 'https://printex.test/schedule?branch=all')
  window.history.forward()
  assert.equal(window.location.href, 'https://printex.test/schedule?branch=demak')
})
test('combined report room and room list are distinct history entries on both reports', () => {
  for (const path of ['/reports', '/archives']) {
    const { window, navigate, entries } = browser(path + '?branch=all&start=2026-10-01')
    navigate(null, 'all')
    navigate(null, 'all')
    assert.equal(entries.length, 2)
    assert.equal(new URL(window.location.href).searchParams.get('room'), 'all')
    navigate(null)
    window.history.back()
    assert.equal(new URL(window.location.href).searchParams.get('room'), 'all')
    window.history.back()
    assert.equal(new URL(window.location.href).searchParams.get('room'), null)
    assert.equal(new URL(window.location.href).searchParams.get('start'), '2026-10-01')
    window.history.forward()
    assert.equal(new URL(window.location.href).searchParams.get('room'), 'all')
  }
})
