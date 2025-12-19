import { getAllowedActivities, isValidActivity } from '../activities/activityRegistry.js';
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  verifyTeacherCodeWithHash,
  resetPersistentSession,
} from '../core/persistentSessions.js';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_COOKIE = 20;
const MAX_TEACHER_CODE_LENGTH = 100;

function parsePersistentSessionsCookie(cookieValue, context = 'persistent_sessions') {
  if (!cookieValue) {
    return { sessions: [], corrupted: false, error: null };
  }

  let parsedCookie;
  try {
    parsedCookie = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue;
  } catch (e) {
    console.error(
      `Failed to parse ${context} cookie; returning empty sessions`,
      {
        error: e,
        cookieLength: typeof cookieValue === 'string' ? cookieValue.length : null,
        cookieType: typeof cookieValue,
      },
    );
    return { sessions: [], corrupted: true, error: 'Invalid JSON format' };
  }

  if (Array.isArray(parsedCookie)) {
    return { sessions: parsedCookie, corrupted: false, error: null };
  } else if (typeof parsedCookie === 'object' && parsedCookie !== null) {
    const sessions = Object.keys(parsedCookie).map(key => ({
      key,
      teacherCode: parsedCookie[key],
    }));
    return { sessions, corrupted: false, error: null };
  }

  console.error(
    `Invalid cookie format for ${context}: expected array or object`,
    { cookieType: typeof parsedCookie },
  );
  return { sessions: [], corrupted: true, error: 'Invalid cookie format: expected array or object' };
}

export function registerPersistentSessionRoutes({ app, sessions }) {
  app.get("/api/persistent-session/list", (req, res) => {
    try {
      const { sessions: sessionEntries } = parsePersistentSessionsCookie(
        req.cookies?.['persistent_sessions'],
        'persistent_sessions (/api/persistent-session/list)'
      );

      const sessionList = sessionEntries
        .map(entry => {
          const parts = entry.key.split(':');
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            console.warn(`Invalid session key format: "${entry.key}"`);
            return null;
          }

          const [activityName, hash] = parts;
          const host = req.get('x-forwarded-host') || req.get('host');
          const protocol = req.get('x-forwarded-proto') || req.protocol;
          return {
            activityName,
            hash,
            teacherCode: entry.teacherCode,
            url: `/activity/${activityName}/${hash}`,
            fullUrl: `${protocol}://${host}/activity/${activityName}/${hash}`,
          };
        })
        .filter(Boolean);

      res.json({ sessions: sessionList });
    } catch (err) {
      console.error('Error in /api/persistent-session/list:', err);
      res.status(500).json({ error: 'Internal server error', sessions: [] });
    }
  });

  app.post("/api/persistent-session/create", (req, res) => {
    const { activityName, teacherCode } = req.body || {};

    if (!activityName || !teacherCode) {
      return res.status(400).json({ error: 'Missing activityName or teacherCode' });
    }
    if (typeof teacherCode !== 'string') {
      return res.status(400).json({ error: 'Teacher code must be a string' });
    }
    if (!isValidActivity(activityName)) {
      return res.status(400).json({
        error: 'Invalid activity name',
        allowedActivities: getAllowedActivities(),
      });
    }
    if (teacherCode.length < 6) {
      return res.status(400).json({ error: 'Teacher code must be at least 6 characters' });
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      return res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` });
    }

    const cookieName = 'persistent_sessions';
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/create)'
    );

    const { hash } = generatePersistentHash(activityName, teacherCode);
    const cookieKey = `${activityName}:${hash}`;

    const existingIndex = sessionEntries.findIndex(entry => entry.key === cookieKey);
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1);
    }
    sessionEntries.push({ key: cookieKey, teacherCode });
    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE);
    }

    res.cookie(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });

    res.json({ url: `/activity/${activityName}/${hash}`, hash });
  });

  app.post("/api/persistent-session/authenticate", async (req, res) => {
    const { activityName, hash, teacherCode } = req.body || {};

    if (!activityName || !hash || !teacherCode) {
      return res.status(400).json({ error: 'Missing activityName, hash, or teacherCode' });
    }
    if (typeof teacherCode !== 'string') {
      return res.status(400).json({ error: 'Teacher code must be a string' });
    }
    if (!isValidActivity(activityName)) {
      return res.status(400).json({
        error: 'Invalid activity name',
        allowedActivities: getAllowedActivities(),
      });
    }
    if (teacherCode.length < 6) {
      return res.status(400).json({ error: 'Teacher code must be at least 6 characters' });
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      return res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` });
    }

    const validation = verifyTeacherCodeWithHash(activityName, hash, teacherCode);
    if (!validation.valid) {
      return res.status(401).json({ error: validation.error || 'Invalid teacher code' });
    }

    const cookieName = 'persistent_sessions';
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/authenticate)'
    );
    const cookieKey = `${activityName}:${hash}`;
    const existingIndex = sessionEntries.findIndex(entry => entry.key === cookieKey);
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1);
    }
    sessionEntries.push({ key: cookieKey, teacherCode });
    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE);
    }

    res.cookie(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    });

    const persistentSession = await getPersistentSession(hash);

    res.json({
      success: true,
      isStarted: !!persistentSession?.sessionId,
      sessionId: persistentSession?.sessionId || null,
    });
  });

  app.get("/api/persistent-session/:hash", async (req, res) => {
    const { hash } = req.params;
    const { activityName } = req.query;

    if (!activityName) {
      return res.status(400).json({ error: 'Missing activityName parameter' });
    }

    let session = await getOrCreateActivePersistentSession(activityName, hash);

    if (session.sessionId) {
      const backingSession = await sessions.get(session.sessionId);
      if (!backingSession) {
        await resetPersistentSession(hash);
        session = await getOrCreateActivePersistentSession(activityName, hash);
      }
    }

    const { sessions: sessionEntries, corrupted: cookieCorrupted } = parsePersistentSessionsCookie(
      req.cookies?.['persistent_sessions'],
      'persistent_sessions (/api/persistent-session/:hash)'
    );
    const cookieKey = `${activityName}:${hash}`;
    const hasTeacherCookie = sessionEntries.some(s => s.key === cookieKey);

    res.json({
      activityName: session.activityName,
      hasTeacherCookie,
      cookieCorrupted,
      isStarted: !!session.sessionId,
      sessionId: session.sessionId,
    });
  });

  app.get("/api/persistent-session/:hash/teacher-code", (req, res) => {
    const { hash } = req.params;
    const { activityName } = req.query;

    if (!activityName) {
      return res.status(400).json({ error: 'Missing activityName parameter' });
    }

    const { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.['persistent_sessions'],
      'persistent_sessions (/api/persistent-session/:hash/teacher-code)'
    );
    const cookieKey = `${activityName}:${hash}`;
    const entry = sessionEntries.find(s => s.key === cookieKey);
    const teacherCode = entry?.teacherCode || null;

    if (teacherCode) {
      res.json({ teacherCode });
    } else {
      res.status(404).json({ error: 'No teacher code found' });
    }
  });
}

export { parsePersistentSessionsCookie };
