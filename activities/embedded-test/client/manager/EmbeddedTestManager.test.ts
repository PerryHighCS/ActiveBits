import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRenderEmbeddedTestEndSessionButton } from './EmbeddedTestManager.js'

void test('shouldRenderEmbeddedTestEndSessionButton hides local end control for embedded child sessions', () => {
  assert.equal(shouldRenderEmbeddedTestEndSessionButton('session-123'), true)
  assert.equal(shouldRenderEmbeddedTestEndSessionButton('CHILD:parent:abc12:embedded-test'), false)
  assert.equal(shouldRenderEmbeddedTestEndSessionButton(undefined), true)
})
