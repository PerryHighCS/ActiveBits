#!/usr/bin/env node

/**
 * Monitor Valkey commands in real-time (equivalent to redis-cli monitor)
 */

import Redis from 'ioredis';

const VALKEY_URL = process.env.VALKEY_URL || 'redis://valkey:6379';

console.log('🔍 Monitoring Valkey commands...');
console.log(`   URL: ${VALKEY_URL}`);
console.log('   Press Ctrl+C to stop\n');

const client = new Redis(VALKEY_URL);

client.monitor((err, monitor) => {
    if (err) {
        console.error('❌ Failed to start monitor:', err.message);
        process.exit(1);
    }

    monitor.on('monitor', (time, args) => {
        const timestamp = new Date(time * 1000).toISOString();
        console.log(`[${timestamp}] ${args.join(' ')}`);
    });
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping monitor...');
    client.quit();
    process.exit(0);
});
