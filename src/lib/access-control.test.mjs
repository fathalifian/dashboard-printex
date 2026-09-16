import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('./access-control.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const access = {}
new Function('exports', compiled)(access)

test('page access is restricted by role, including direct and nested URLs', () => {
  for (const role of ['operator', 'staff']) {
    for (const path of ['/', '/dashboard', '/schedule', '/schedule/']) assert.equal(access.canAccessPage(role, path), true)
    for (const path of ['/orders', '/orders/new', '/orders/123', '/orders/123/edit', '/reports', '/archives', '/history', '/tracking', '/settings', '/settings/users', '/dashboard/extra']) {
      assert.equal(access.canAccessPage(role, path), false, `${role}: ${path}`)
    }
  }
  for (const role of ['owner', 'admin']) {
    for (const path of ['/orders/new', '/orders/123/edit', '/reports', '/archives', '/settings']) assert.equal(access.canAccessPage(role, path), true)
    assert.equal(access.canAccessPage(role, '/settings/users'), role === 'owner')
  }
  for (const unknown of [null, undefined, '', 'guest', 'OWNER']) {
    assert.equal(access.canAccessPage(unknown, '/dashboard'), false)
    assert.equal(access.canManageOrders(unknown), false)
    assert.equal(access.canManageUsers(unknown), false)
  }
})

test('operators must have both move endpoints inside their four stages', () => {
  const all = ['incoming', 'design', 'design_done', 'printing', 'press', 'done', 'archive']
  const allowed = ['design_done', 'printing', 'press', 'done']
  for (const from of all) {
    assert.equal(access.canDragStage('operator', from), allowed.includes(from))
    for (const to of all) assert.equal(access.canMoveBetweenStages('operator', from, to), allowed.includes(from) && allowed.includes(to), `${from} -> ${to}`)
  }
  assert.equal(access.canManageOrders('operator'), false)
  assert.equal(access.canManageUsers('admin'), false)
  assert.equal(access.canManageUsers('owner'), true)
  assert.equal(access.roleLabel('superadmin'), 'Owner')
  assert.equal(access.roleLabel('staff'), 'Operator')
})
