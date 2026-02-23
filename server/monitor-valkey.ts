#!/usr/bin/env node

import Redis from 'ioredis'

interface RedisMonitor {
  on(event: 'monitor', handler: (time: number, args: string[]) => void): void
}

interface RedisLike {
  monitor(callback: (error: Error | null, monitor: RedisMonitor) => void): void
  quit(): Promise<unknown>
}

type RedisConstructor = new (url: string) => RedisLike

const VALKEY_URL = process.env.VALKEY_URL || 'redis://valkey:6379'

console.log('Monitoring Valkey commands...')
console.log(`URL: ${VALKEY_URL}`)
console.log('Press Ctrl+C to stop\n')

const RedisCtor = Redis as unknown as RedisConstructor
const client = new RedisCtor(VALKEY_URL)

client.monitor((error, monitor) => {
  if (error) {
    console.error('Failed to start monitor:', error.message)
    process.exit(1)
  }

  monitor.on('monitor', (time, args) => {
    const timestamp = new Date(time * 1000).toISOString()
    console.log(`[${timestamp}] ${args.join(' ')}`)
  })
})

process.on('SIGINT', () => {
  console.log('\n\nStopping monitor...')
  void client.quit()
  process.exit(0)
})
