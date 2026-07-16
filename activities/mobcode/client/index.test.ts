import assert from 'node:assert/strict'
import test from 'node:test'
import { launchMobCodePersistentSoloEntry } from './index'

void test('launchMobCodePersistentSoloEntry creates a server-backed workspace with the supplied starter files', async () => {
  const request: { current: { input: RequestInfo | URL; init?: RequestInit } | null } = { current: null }
  const result = await launchMobCodePersistentSoloEntry({
    hash: '',
    search: '',
    selectedOptions: {
      files: { 'starter.py': 'print("ready")' },
      activeFile: 'starter.py',
      runnerId: 'brython-terminal',
    },
  }, async (input, init) => {
    request.current = { input, init }
    return new Response(JSON.stringify({ id: 'solo-session', soloEditToken: 'opaque-token' }), { status: 200 })
  })

  assert.equal(request.current?.input, '/api/mobcode/create-solo')
  assert.deepEqual(JSON.parse(String(request.current?.init?.body)), {
    files: { 'starter.py': 'print("ready")' },
    activeFile: 'starter.py',
    runnerId: 'brython-terminal',
  })
  assert.deepEqual(result, { navigateTo: '/solo-session?mobcodeSoloToken=opaque-token' })
})
