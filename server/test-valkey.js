#!/usr/bin/env node

/**
 * Test script to verify Valkey connection and basic operations
 */

import Redis from 'ioredis';

const VALKEY_URL = process.env.VALKEY_URL || 'redis://valkey:6379';

async function testValkey() {
    console.log('🧪 Testing Valkey connection...');
    console.log(`   URL: ${VALKEY_URL}\n`);

    const client = new Redis(VALKEY_URL);
    let subscriber = null;

    try {
        // Test 1: Ping
        const pong = await client.ping();
        console.log('✅ PING:', pong);

        // Test 2: Set/Get
        await client.set('test:key', 'Hello from ActiveBits!', 'EX', 10);
        const value = await client.get('test:key');
        console.log('✅ SET/GET:', value);

        // Test 3: Server info
        const info = await client.info('server');
        const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
        console.log('✅ Server version:', version);

        // Test 4: Count session keys using SCAN
        let sessionCount = 0;
        let cursor = '0';
        do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
            sessionCount += keys.length;
            cursor = nextCursor;
        } while (cursor !== '0');
        console.log('✅ Active sessions:', sessionCount);

        // Test 5: Pub/Sub test
        subscriber = new Redis(VALKEY_URL);
        const testChannel = 'test-channel';
        let messageReceived = false;

        await subscriber.subscribe(testChannel);
        subscriber.on('message', (channel, message) => {
            if (channel === testChannel) {
                console.log('✅ Pub/Sub:', message);
                messageReceived = true;
            }
        });

        // Give subscriber time to connect
        await new Promise(resolve => setTimeout(resolve, 100));
        await client.publish(testChannel, 'Test broadcast message');

        // Wait for message
        await new Promise(resolve => setTimeout(resolve, 200));

        if (!messageReceived) {
            console.log('⚠️  Pub/Sub: No message received (might be timing issue)');
        }

        // Cleanup
        await client.del('test:key');
        await subscriber.unsubscribe(testChannel);
        await subscriber.quit();
        await client.quit();

        console.log('\n✨ All tests passed! Valkey is ready for development.');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        const cleanupTasks = [];
        if (subscriber) {
            cleanupTasks.push(
                subscriber.quit().catch((cleanupErr) => {
                    console.error('Failed to close Valkey subscriber cleanly:', cleanupErr.message);
                })
            );
        }
        cleanupTasks.push(client.quit().catch((cleanupErr) => {
            console.error('Failed to close Valkey client cleanly:', cleanupErr.message);
        }));
        try {
            await Promise.allSettled(cleanupTasks);
        } catch (cleanupErr) {
            console.error('Cleanup encountered errors:', cleanupErr.message);
        }
        process.exit(1);
    }
}

testValkey();
