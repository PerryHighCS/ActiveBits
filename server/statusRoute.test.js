import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerStatusRoute } from "./routes/statusRoute.js";

function createWsMock(clients = []) {
    return {
        wss: {
            clients: new Set(clients),
        },
    };
}

async function startStatusServer(t, { sessions, ws, sessionTtl = 60 * 60 * 1000, valkeyUrl = null }) {
    const app = express();
    registerStatusRoute({ app, sessions, ws, sessionTtl, valkeyUrl });

    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });

    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

test("status endpoint returns session info in memory mode", async (t) => {
    const now = Date.now();
    const sessions = {
        getAll: async () => [{
            id: "abc",
            type: "raffle",
            created: now - 5000,
            lastActivity: now - 1000,
            data: {},
        }],
        ttlMs: 60 * 60 * 1000,
    };
    const ws = createWsMock([{ sessionId: "abc", readyState: 1 }]);

    const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: sessions.ttlMs, valkeyUrl: null });
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.sessions.count, 1);
    assert.equal(body.sessions.list.length, 1);
    const session = body.sessions.list[0];
    assert.equal(session.id, "abc");
    assert.equal(session.type, "raffle");
    assert.equal(session.socketCount, 1);
    assert.equal(body.sessions.showSessionIds, true);
});

test("status endpoint masks session ids in production", async (t) => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    t.after(() => {
        process.env.NODE_ENV = prevEnv;
    });

    const sessions = {
        getAll: async () => [{
            id: "hidden-session",
            type: "raffle",
            created: Date.now(),
            lastActivity: Date.now(),
            data: {},
        }],
        ttlMs: 1000,
    };
    const ws = createWsMock();
    const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: sessions.ttlMs, valkeyUrl: null });
    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();
    assert.equal(body.sessions.showSessionIds, false);
    assert.equal(body.sessions.list[0].id, undefined);
});

test("status endpoint reports Valkey TTLs and expiry data", async (t) => {
    const now = Date.now();
    const sessions = {
        getAll: async () => [{
            id: "ttl-session",
            type: "python-list-practice",
            created: now - 10000,
            lastActivity: now - 5000,
            data: {},
        }],
        valkeyStore: {
            ttlMs: 90_000,
            client: {
                pttl: async () => 5000,
                ping: async () => "PONG",
                dbsize: async () => 1,
                call: async () => "used_memory:1024\r\nused_memory_rss:2048\r\n",
            },
        },
    };
    const ws = createWsMock();
    const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: 90_000, valkeyUrl: "redis://valkey:6379" });
    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();
    assert.equal(body.sessions.list[0].ttlRemainingMs, 5000);
    assert.ok(Date.parse(body.sessions.list[0].expiresAt) > Date.now());
    assert.equal(body.valkey.dbsize, 1);
    assert.equal(body.valkey.memory.used_memory, "1024");
    assert.equal(body.storage.mode, "valkey");
});

test("status endpoint handles Valkey errors gracefully", async (t) => {
    const sessions = {
        getAll: async () => [],
        valkeyStore: {
            ttlMs: 60_000,
            client: {
                pttl: async () => { throw new Error("pttl failure"); },
                ping: async () => { throw new Error("boom"); },
                dbsize: async () => 0,
                call: async () => "",
            },
        },
    };
    const ws = createWsMock();
    const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: 60_000, valkeyUrl: "redis://valkey:6379" });
    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();
    assert.equal(body.sessions.count, 0);
    assert.equal(body.valkey.error, "boom");
});
