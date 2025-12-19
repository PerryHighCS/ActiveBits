import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPersistentSessionRoutes } from './routes/persistentSessionRoutes.js';
import {
  initializePersistentStorage,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  startPersistentSession,
  resetPersistentSession,
  cleanupPersistentSession,
} from './core/persistentSessions.js';

function createMockApp() {
  const routes = { get: new Map(), post: new Map() };
  return {
    use() {},
    get(path, handler) { routes.get.set(path, handler); },
    post(path, handler) { routes.post.set(path, handler); },
    routes,
  };
}

function createMockReq({ params = {}, query = {}, cookies = {}, body = {}, headers = {}, protocol = 'http' } = {}) {
  return {
    params,
    query,
    cookies,
    body,
    protocol,
    get(name) {
      const key = name.toLowerCase();
      return headers[key];
    },
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    cookies: new Map(),
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return payload;
    },
    cookie(name, value, options) {
      this.cookies.set(name, { value, options });
    },
  };
}

function buildCookieValue(activityName, hash, teacherCode) {
  return JSON.stringify([{ key: `${activityName}:${hash}`, teacherCode }]);
}

function getRoute(app, method, path) {
  const store = method === 'GET' ? app.routes.get : app.routes.post;
  const handler = store.get(path);
  if (!handler) throw new Error(`Route ${method} ${path} not registered`);
  return handler;
}

test('persistent session route keeps valid backing session', async (t) => {
  initializePersistentStorage(null);
  const sessionMap = new Map();
  const sessions = { get: async (id) => sessionMap.get(id) };
  const app = createMockApp();
  registerPersistentSessionRoutes({ app, sessions });
  const handler = getRoute(app, 'GET', "/api/persistent-session/:hash");

  const activityName = 'gallery-walk';
  const teacherCode = 'secret-code';
  const { hash } = generatePersistentHash(activityName, teacherCode);
  t.after(async () => cleanupPersistentSession(hash));

  await getOrCreateActivePersistentSession(activityName, hash);
  sessionMap.set('live-session', { id: 'live-session' });
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws' });

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.isStarted, true);
  assert.equal(res.jsonBody.sessionId, 'live-session');
});

test('persistent session route resets when backing session missing', async (t) => {
  initializePersistentStorage(null);
  const sessionMap = new Map();
  const sessions = { get: async (id) => sessionMap.get(id) };
  const app = createMockApp();
  registerPersistentSessionRoutes({ app, sessions });
  const handler = getRoute(app, 'GET', "/api/persistent-session/:hash");

  const activityName = 'gallery-walk';
  const teacherCode = 'missing-code';
  const { hash } = generatePersistentHash(activityName, teacherCode);
  t.after(async () => cleanupPersistentSession(hash));

  await getOrCreateActivePersistentSession(activityName, hash);
  await startPersistentSession(hash, 'ghost-session', { id: 'teacher-ws' });

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  });
  const res = createMockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.isStarted, false);
  assert.equal(res.jsonBody.sessionId, null);

  const stored = await getPersistentSession(hash);
  assert.equal(stored.sessionId, null);
});

test('persistent session route allows recreation after reset', async (t) => {
  initializePersistentStorage(null);
  const sessionMap = new Map();
  const sessions = { get: async (id) => sessionMap.get(id) };
  const app = createMockApp();
  registerPersistentSessionRoutes({ app, sessions });
  const handler = getRoute(app, 'GET', "/api/persistent-session/:hash");

  const activityName = 'gallery-walk';
  const teacherCode = 'restart-code';
  const { hash } = generatePersistentHash(activityName, teacherCode);
  t.after(async () => cleanupPersistentSession(hash));

  await getOrCreateActivePersistentSession(activityName, hash);
  await startPersistentSession(hash, 'expired-session', { id: 'teacher-ws' });

  const cookieValue = buildCookieValue(activityName, hash, teacherCode);
  const firstReq = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  });
  const firstRes = createMockRes();
  await handler(firstReq, firstRes);
  assert.equal(firstRes.jsonBody.isStarted, false);

  sessionMap.set('new-session', { id: 'new-session' });
  await startPersistentSession(hash, 'new-session', { id: 'teacher-ws-2' });

  const secondReq = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  });
  const secondRes = createMockRes();
  await handler(secondReq, secondRes);
  assert.equal(secondRes.jsonBody.isStarted, true);
  assert.equal(secondRes.jsonBody.sessionId, 'new-session');
});

test('teacher lifecycle clears session on explicit end', async (t) => {
  initializePersistentStorage(null);
  const sessionMap = new Map();
  const sessions = {
    get: async (id) => sessionMap.get(id),
    delete: async (id) => { sessionMap.delete(id); },
  };
  const app = createMockApp();
  registerPersistentSessionRoutes({ app, sessions });

  const activityName = 'gallery-walk';
  const teacherCode = 'teacher-end';
  const { hash } = generatePersistentHash(activityName, teacherCode);
  t.after(async () => cleanupPersistentSession(hash));

  const cookieValue = buildCookieValue(activityName, hash, teacherCode);
  await getOrCreateActivePersistentSession(activityName, hash);
  sessionMap.set('lifecycle-session', { id: 'lifecycle-session' });
  await startPersistentSession(hash, 'lifecycle-session', { id: 'teacher-ws' });

  await resetPersistentSession(hash);
  await sessions.delete('lifecycle-session');
  const stored = await getPersistentSession(hash);
  assert.equal(stored.sessionId, null);

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  });
  const res = createMockRes();
  await getRoute(app, 'GET', "/api/persistent-session/:hash")(req, res);
  assert.equal(res.jsonBody.isStarted, false);
});
