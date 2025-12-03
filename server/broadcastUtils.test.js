import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastSubscriptionHelper } from "./core/broadcastUtils.js";

test("createBroadcastSubscriptionHelper subscribes once and forwards messages", () => {
    let subscribedChannel = null;
    let broadcastHandler = null;
    const sessions = {
        subscribeToBroadcast: (channel, handler) => {
            if (subscribedChannel) {
                throw new Error("subscribe called multiple times");
            }
            subscribedChannel = channel;
            broadcastHandler = handler;
        },
    };

    const sentPayloads = [];
    const ws = {
        wss: {
            clients: new Set([
                { sessionId: "abc", readyState: 1, send: (msg) => sentPayloads.push(msg) },
                { sessionId: "abc", readyState: 0, send: () => { throw new Error("should not send when not ready"); } },
                { sessionId: "other", readyState: 1, send: () => { throw new Error("wrong session"); } },
                {
                    sessionId: "abc",
                    readyState: 1,
                    send: () => {
                        throw new Error("send failure");
                    },
                },
            ]),
        },
    };

    const ensure = createBroadcastSubscriptionHelper(sessions, ws);
    ensure("abc");
    ensure("abc"); // duplicate should be ignored
    ensure(""); // invalid sessionId ignored

    assert.equal(subscribedChannel, "session:abc:broadcast");
    assert.ok(broadcastHandler, "handler registered");

    assert.doesNotThrow(() => broadcastHandler({ type: "foo" }));
    assert.equal(sentPayloads.length, 1);
    assert.equal(sentPayloads[0], JSON.stringify({ type: "foo" }));
});

test("createBroadcastSubscriptionHelper no-ops without subscribe support or session id", () => {
    const sessions = {};
    const ws = { wss: { clients: new Set() } };
    const ensure = createBroadcastSubscriptionHelper(sessions, ws);
    assert.doesNotThrow(() => ensure("abc"));
    assert.doesNotThrow(() => ensure(null));

    const sessionsWithSubscribe = {
        subscribeToBroadcast: () => {
            throw new Error("should not subscribe when sessionId missing");
        },
    };
    const ensureMissingId = createBroadcastSubscriptionHelper(sessionsWithSubscribe, ws);
    assert.doesNotThrow(() => ensureMissingId(null));
});
