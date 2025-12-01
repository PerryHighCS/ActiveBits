import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import WebSocket from 'ws';
import { createSessionStore, createSession } from './core/sessions.js';
import { createWsRouter } from './core/wsRouter.js';

const wait = ms => new Promise(res => setTimeout(res, ms));

test('inactive sessions expire', async () => {
    const sessions = createSessionStore(null, 50); // In-memory mode, 50ms TTL
    const s = await createSession(sessions);
    await wait(60);
    sessions.cleanup();
    assert.strictEqual(await sessions.get(s.id), null);
});

test('active sessions persist', async () => {
    const sessions = createSessionStore(null, 50); // In-memory mode
    const s = await createSession(sessions);
    await wait(40);
    await sessions.touch(s.id); // touch
    await wait(40);
    sessions.cleanup();
    assert.ok(await sessions.get(s.id));
    await wait(60);
    sessions.cleanup();
    assert.strictEqual(await sessions.get(s.id), null);
});

test('keepalive refreshes session activity', async () => {
    const sessions = createSessionStore(null, 50); // In-memory mode
    const s = await createSession(sessions);
    const server = http.createServer();
    const router = createWsRouter(server, sessions);
    router.register('/ws', (socket, qp) => {
        socket.sessionId = qp.get('sessionId');
    });

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const ws = new WebSocket(`ws://localhost:${port}/ws?sessionId=${s.id}`);
    await new Promise(res => ws.once('open', res));

    await wait(40);
    await new Promise(res => { ws.once('pong', res); ws.ping(); });
    await wait(20);
    sessions.cleanup();
    assert.ok(await sessions.get(s.id));

    await wait(60);
    sessions.cleanup();
    assert.strictEqual(await sessions.get(s.id), null);

    ws.close();
    await new Promise(res => server.close(res));
});
