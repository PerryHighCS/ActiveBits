import assert from 'node:assert/strict'
import test from 'node:test'
import { readEmbeddedLaunchSelectedOptions } from './embeddedLaunchBootstrap'

void test('readEmbeddedLaunchSelectedOptions returns selected options from generic session payload', () => {
  assert.deepEqual(
    readEmbeddedLaunchSelectedOptions({
      session: {
        data: {
          embeddedLaunch: {
            parentSessionId: 's1',
            instanceKey: 'video-sync:3:0',
            selectedOptions: {
              sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
            },
          },
        },
      },
    }),
    {
      sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
    },
  )
})

void test('readEmbeddedLaunchSelectedOptions returns null for missing or malformed payloads', () => {
  assert.equal(readEmbeddedLaunchSelectedOptions(null), null)
  assert.equal(readEmbeddedLaunchSelectedOptions({}), null)
  assert.equal(
    readEmbeddedLaunchSelectedOptions({
      session: {
        data: {
          embeddedLaunch: {
            selectedOptions: 'nope',
          },
        },
      },
    }),
    null,
  )
})
