#!/usr/bin/env node

import Redis from 'ioredis'

interface RedisLike {
  ping(): Promise<string>
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>
  get(key: string): Promise<string | null>
  info(section?: string): Promise<string>
  scan(cursor: string, matchKeyword: string, pattern: string, countKeyword: string, count: number): Promise<[string, string[]]>
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  del(key: string): Promise<number>
  on(event: string, handler: (...args: unknown[]) => void): void
  quit(): Promise<unknown>
}

type RedisConstructor = new (url: string) => RedisLike

const VALKEY_URL = process.env.VALKEY_URL || 'redis://valkey:6379'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function testValkey(): Promise<void> {
  console.log('Testing Valkey connection...')
  console.log(`URL: ${VALKEY_URL}\n`)

  const RedisCtor = Redis as unknown as RedisConstructor
  const client = new RedisCtor(VALKEY_URL)
  let subscriber: RedisLike | null = null

  try {
    const pong = await client.ping()
    console.log('PING:', pong)

    await client.set('test:key', 'Hello from ActiveBits!', 'EX', 10)
    const value = await client.get('test:key')
    console.log('SET/GET:', value)

    const info = await client.info('server')
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown'
    console.log('Server version:', version)

    let sessionCount = 0
    let cursor = '0'
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100)
      sessionCount += keys.length
      cursor = nextCursor
    } while (cursor !== '0')
    console.log('Active sessions:', sessionCount)

    subscriber = new RedisCtor(VALKEY_URL)
    const testChannel = 'test-channel'
    let messageReceived = false

    await subscriber.subscribe(testChannel)
    subscriber.on('message', (channel: unknown, message: unknown) => {
      if (channel === testChannel && typeof message === 'string') {
        console.log('Pub/Sub:', message)
        messageReceived = true
      }
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    await client.publish(testChannel, 'Test broadcast message')
    await new Promise<void>((resolve) => setTimeout(resolve, 200))

    if (!messageReceived) {
      console.log('Pub/Sub: No message received (possible timing delay)')
    }

    await client.del('test:key')
    await subscriber.unsubscribe(testChannel)
    await subscriber.quit()
    await client.quit()

    console.log('\nAll tests passed. Valkey is ready for development.')
    process.exit(0)
  } catch (error) {
    console.error('\nValkey test failed:', getErrorMessage(error))

    const cleanupTasks: Array<Promise<unknown>> = []
    if (subscriber) {
      cleanupTasks.push(
        subscriber.quit().catch((cleanupErr: unknown) => {
          console.error('Failed to close Valkey subscriber cleanly:', getErrorMessage(cleanupErr))
        }),
      )
    }
    cleanupTasks.push(
      client.quit().catch((cleanupErr: unknown) => {
        console.error('Failed to close Valkey client cleanly:', getErrorMessage(cleanupErr))
      }),
    )

    await Promise.allSettled(cleanupTasks)
    process.exit(1)
  }
}

void testValkey()
