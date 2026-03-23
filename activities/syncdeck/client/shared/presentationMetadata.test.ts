import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncDeckDocumentTitle,
  extractRevealMetadataTitle,
  isRevealIframeReadySignal,
} from './presentationMetadata.js'

void test('extractRevealMetadataTitle returns trimmed metadata title from reveal-sync metadata envelopes', () => {
  assert.equal(
    extractRevealMetadataTitle({
      type: 'reveal-sync',
      action: 'metadata',
      payload: {
        title: '  Bridge Critique Day  ',
      },
    }),
    'Bridge Critique Day',
  )
})

void test('extractRevealMetadataTitle ignores non-metadata and empty titles', () => {
  assert.equal(
    extractRevealMetadataTitle({
      type: 'reveal-sync',
      action: 'state',
      payload: {
        title: 'Ignored',
      },
    }),
    null,
  )
  assert.equal(
    extractRevealMetadataTitle({
      type: 'reveal-sync',
      action: 'metadata',
      payload: {
        title: '   ',
      },
    }),
    null,
  )
})

void test('extractRevealMetadataTitle accepts early standalone-role metadata messages', () => {
  assert.equal(
    extractRevealMetadataTitle({
      type: 'reveal-sync',
      action: 'metadata',
      role: 'standalone',
      payload: {
        title: 'Standalone Intro Deck',
      },
    }),
    'Standalone Intro Deck',
  )
})

void test('isRevealIframeReadySignal excludes metadata but accepts ready and state envelopes', () => {
  assert.equal(
    isRevealIframeReadySignal({
      type: 'reveal-sync',
      action: 'metadata',
      payload: {
        title: 'Bridge Critique Day',
      },
    }),
    false,
  )
  assert.equal(
    isRevealIframeReadySignal({
      type: 'reveal-sync',
      action: 'ready',
      payload: {},
    }),
    true,
  )
  assert.equal(
    isRevealIframeReadySignal({
      type: 'reveal-sync',
      action: 'state',
      payload: {},
    }),
    true,
  )
})

void test('isRevealIframeReadySignal accepts early standalone-role ready messages', () => {
  assert.equal(
    isRevealIframeReadySignal({
      type: 'reveal-sync',
      action: 'ready',
      role: 'standalone',
      payload: {},
    }),
    true,
  )
})

void test('buildSyncDeckDocumentTitle appends ActiveBits suffix and falls back cleanly', () => {
  assert.equal(buildSyncDeckDocumentTitle('Bridge Critique Day'), 'Bridge Critique Day | ActiveBits')
  assert.equal(buildSyncDeckDocumentTitle(null), 'ActiveBits')
})
