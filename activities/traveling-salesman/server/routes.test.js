import test from 'node:test';
import assert from 'node:assert/strict';
import setupTravelingSalesmanRoutes from './routes.js';
import { isCitiesArray, isDistanceMatrix, isRouteArray } from './validation.js';

const createMockApp = () => {
  const handlers = { post: {}, get: {} };
  return {
    handlers,
    post(path, handler) {
      handlers.post[path] = handler;
    },
    get(path, handler) {
      handlers.get[path] = handler;
    }
  };
};

const createMockSessions = (store) => ({
  async get(id) {
    return store[id];
  },
  async set(id, session) {
    store[id] = session;
  }
});

const createMockWs = () => ({
  wss: { clients: new Set() },
  register() {}
});

const createRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
};

const setup = () => {
  const store = {
    s1: {
      id: 's1',
      type: 'traveling-salesman',
      data: {
        problem: { numCities: 2 },
        students: [],
        algorithms: { bruteForce: {}, heuristic: {} },
        instructor: null,
        broadcasts: []
      }
    }
  };
  const app = createMockApp();
  const sessions = createMockSessions(store);
  const ws = createMockWs();
  setupTravelingSalesmanRoutes(app, sessions, ws);
  return { app, sessions, store };
};

test('set-problem rejects invalid cities payload', async () => {
  const { app } = setup();
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/set-problem'];
  const req = {
    params: { sessionId: 's1' },
    body: { cities: 'bad', distanceMatrix: [], seed: 123 }
  };
  const res = createRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('submit-route rejects missing student', async () => {
  const { app } = setup();
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/submit-route'];
  const req = {
    params: { sessionId: 's1' },
    body: { studentId: 'missing', route: ['city-0'], distance: 0, timeToComplete: 0 }
  };
  const res = createRes();
  await handler(req, res);
  assert.equal(res.statusCode, 404);
});

test('submit-route accepts timeToComplete=0', async () => {
  const { app, store } = setup();
  store.s1.data.problem.numCities = 1;
  store.s1.data.students.push({
    id: 'student-1',
    name: 'Tester',
    currentRoute: [],
    routeDistance: 0,
    complete: false
  });
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/submit-route'];
  const req = {
    params: { sessionId: 's1' },
    body: { studentId: 'student-1', route: ['city-0'], distance: 0, timeToComplete: 0 }
  };
  const res = createRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.s1.data.students[0].timeToComplete, 0);
});

test('update-instructor-route rejects invalid timeToComplete', async () => {
  const { app } = setup();
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/update-instructor-route'];
  const req = {
    params: { sessionId: 's1' },
    body: { route: ['city-0'], distance: 1, complete: true, timeToComplete: 'nope' }
  };
  const res = createRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('validation helpers accept valid inputs', () => {
  assert.equal(isRouteArray(['city-0', 'city-1']), true);
  assert.equal(isCitiesArray([{ id: 'city-0', name: 'A', x: 1, y: 2 }]), true);
  assert.equal(isDistanceMatrix([[0, 1], [1, 0]], 2), true);
});

test('validation helpers reject invalid inputs', () => {
  assert.equal(isRouteArray(['city-0', 2]), false);
  assert.equal(isCitiesArray([{ id: 'city-0', name: 'A', x: 'bad', y: 2 }]), false);
  assert.equal(isDistanceMatrix([[0, 1]], 2), false);
});
