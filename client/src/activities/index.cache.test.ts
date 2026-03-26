import assert from 'node:assert/strict'
import test from 'node:test'

import { createClientModuleResolverCache, shouldUseClientModuleResolutionCache } from './index'

void test('shouldUseClientModuleResolutionCache disables caching in development and HMR runtimes', () => {
  assert.equal(
    shouldUseClientModuleResolutionCache({ isDevelopment: false, hasHotModuleReload: false }),
    true,
  )
  assert.equal(
    shouldUseClientModuleResolutionCache({ isDevelopment: true, hasHotModuleReload: false }),
    false,
  )
  assert.equal(
    shouldUseClientModuleResolutionCache({ isDevelopment: false, hasHotModuleReload: true }),
    false,
  )
})

void test('createClientModuleResolverCache reuses resolved modules when caching is enabled', async () => {
  let resolveCount = 0
  const cache = createClientModuleResolverCache({
    useCache: true,
    resolveModule: async () => {
      resolveCount += 1
      return { marker: resolveCount }
    },
  })

  const first = await cache.getCachedClientModule('syncdeck', async () => ({}))
  const second = await cache.getCachedClientModule('syncdeck', async () => ({}))

  assert.equal(resolveCount, 1)
  assert.equal(first, second)
})

void test('createClientModuleResolverCache bypasses resolved-module caching when disabled', async () => {
  let resolveCount = 0
  const cache = createClientModuleResolverCache({
    useCache: false,
    resolveModule: async () => {
      resolveCount += 1
      return { marker: resolveCount }
    },
  })

  const first = await cache.getCachedClientModule('syncdeck', async () => ({}))
  const second = await cache.getCachedClientModule('syncdeck', async () => ({}))

  assert.equal(resolveCount, 2)
  assert.notEqual(first, second)
})

void test('createClientModuleResolverCache clears cached modules on HMR dispose', async () => {
  let disposeHandler: (() => void) | undefined
  let resolveCount = 0
  const cache = createClientModuleResolverCache({
    useCache: true,
    hotModule: {
      dispose(callback) {
        disposeHandler = callback
      },
    },
    resolveModule: async () => {
      resolveCount += 1
      return { marker: resolveCount }
    },
  })

  const first = await cache.getCachedClientModule('syncdeck', async () => ({}))
  disposeHandler?.()
  const second = await cache.getCachedClientModule('syncdeck', async () => ({}))

  assert.equal(resolveCount, 2)
  assert.notEqual(first, second)
})
