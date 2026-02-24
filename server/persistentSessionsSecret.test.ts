import test from 'node:test'
import assert from 'node:assert/strict'

void test('resolvePersistentSessionSecret caches value and warning behavior per process', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousSecret = process.env.PERSISTENT_SESSION_SECRET
  const originalWarn = console.warn
  const warnings: string[] = []

  try {
    process.env.NODE_ENV = 'development'
    process.env.PERSISTENT_SESSION_SECRET = 'a'

    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '))
    }

    const modulePath = `./core/persistentSessions.ts?test=${Date.now()}-${Math.random()}`
    const persistentSessionsModule = (await import(modulePath)) as {
      resolvePersistentSessionSecret: () => string
    }
    const firstResolved = persistentSessionsModule.resolvePersistentSessionSecret()
    assert.equal(firstResolved, 'a')

    process.env.PERSISTENT_SESSION_SECRET = 'this-is-a-strong-development-secret-value-12345'
    const secondResolved = persistentSessionsModule.resolvePersistentSessionSecret()
    assert.equal(secondResolved, 'a')

    const lengthWarnings = warnings.filter((entry) => entry.includes('must be at least'))
    const weakWarnings = warnings.filter((entry) => entry.includes('appears to be a weak or default value'))

    assert.equal(lengthWarnings.length, 1)
    assert.equal(weakWarnings.length, 0)
  } finally {
    console.warn = originalWarn

    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previousNodeEnv
    }

    if (previousSecret === undefined) {
      delete process.env.PERSISTENT_SESSION_SECRET
    } else {
      process.env.PERSISTENT_SESSION_SECRET = previousSecret
    }
  }
})
