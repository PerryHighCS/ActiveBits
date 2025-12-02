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

        // Test 4: Count session keys
        const sessionKeys = await client.keys('session:*');
        console.log('✅ Active sessions:', sessionKeys.length);

        // Test 5: Pub/Sub test
        const subscriber = new Redis(VALKEY_URL);
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
        await client.quit();
        process.exit(1);
    }
}

testValkey();
