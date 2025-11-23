import {
  getOrCreateActivePersistentSession,
  getPersistentSession,
  addWaiter,
  removeWaiter,
  getWaiterCount,
  canAttemptTeacherCode,
  recordTeacherCodeAttempt,
  verifyTeacherCodeWithHash,
  startPersistentSession,
  isSessionStarted,
  getSessionId,
} from './persistentSessions.js';
import { createSession } from './sessions.js';

/**
 * Setup WebSocket handlers for persistent session waiting rooms
 * @param {object} ws - The WebSocket router
 * @param {object} sessions - The session store
 */
export function setupPersistentSessionWs(ws, sessions) {
  ws.register("/ws/persistent-session", (socket, qp, wss) => {
    const hash = qp.get("hash") || null;
    const activityName = qp.get("activityName") || null;
    
    if (!hash || !activityName) {
      socket.close(1008, "Missing hash or activityName");
      return;
    }

    // Get or create the active session
    const session = getOrCreateActivePersistentSession(activityName, hash);

    // Store hash on socket for cleanup
    socket.persistentHash = hash;

    // If session already started, redirect to actual session
    if (isSessionStarted(hash)) {
      socket.send(JSON.stringify({
        type: 'session-started',
        sessionId: getSessionId(hash),
      }));
      socket.close(1000, "Session already started");
      return;
    }

    // Add to waiters
    const waiterCount = addWaiter(hash, socket);
    
    // Broadcast waiter count to all waiters
    broadcastWaiterCount(hash, session);

    console.log(`Waiter joined persistent session ${hash}, total waiters: ${waiterCount}`);

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'verify-teacher-code') {
          handleTeacherCodeVerification(socket, hash, message.teacherCode, sessions, wss);
        }
      } catch (err) {
        console.error('Error handling persistent session message:', err);
      }
    });

    socket.on("close", () => {
      removeWaiter(hash, socket);
      broadcastWaiterCount(hash, session);
      console.log(`Waiter left persistent session ${hash}`);
    });
  });
}

/**
 * Handle teacher code verification
 * @param {object} socket - The WebSocket connection
 * @param {string} hash - The persistent hash
 * @param {string} teacherCode - The teacher code to verify
 * @param {object} sessions - The session store
 * @param {object} wss - The WebSocket server
 */
function handleTeacherCodeVerification(socket, hash, teacherCode, sessions, wss) {
  // Validate teacherCode input
  if (!teacherCode || typeof teacherCode !== 'string') {
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: 'Invalid teacher code format',
    }));
    return;
  }

  // Prevent DoS attacks through extremely long strings
  // Reasonable limit: 100 characters (typical codes are much shorter)
  const MAX_TEACHER_CODE_LENGTH = 100;
  if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: 'Teacher code too long',
    }));
    return;
  }

  // Use IP + hash combination for rate limiting to avoid false positives
  // in proxy/NAT environments where multiple users share the same IP
  const clientIp = socket.clientIp || 'unknown';
  const rateLimitKey = `${clientIp}:${hash}`;
  
  // Rate limiting check
  if (!canAttemptTeacherCode(rateLimitKey)) {
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: 'Too many attempts. Please wait a minute.',
    }));
    return;
  }

  recordTeacherCodeAttempt(rateLimitKey);

  // Get the session and verify teacher code
  const persistentSession = getPersistentSession(hash);
  if (!persistentSession) {
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: 'Session not found',
    }));
    return;
  }

  // Verify the teacher code against the hash
  const validation = verifyTeacherCodeWithHash(persistentSession.activityName, hash, teacherCode);
  
  if (!validation.valid) {
    // Log validation failures (only show error details in development)
    const logMessage = `Teacher code validation failed for hash ${hash}, activity ${persistentSession.activityName}`;
    if (process.env.NODE_ENV?.startsWith('dev')) {
      console.log(`${logMessage}: ${validation.error}`);
    } else {
      console.log(logMessage);
    }
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: validation.error,
    }));
    return;
  }

  // Code is valid! Create the actual session
  const newSession = createSession(sessions, { data: {} });
  
  // Set up session based on activity type
  newSession.type = persistentSession.activityName;
  
  // Initialize activity-specific data
  switch (persistentSession.activityName) {
    case 'raffle':
      newSession.data.tickets = [];
      break;
    case 'www-sim':
      newSession.data.students = [];
      newSession.data.studentTemplates = {};
      break;
    case 'java-string-practice':
      newSession.data.students = [];
      newSession.data.selectedMethods = [];
      break;
    default:
      break;
  }

  console.log(`Created session ${newSession.id} for persistent session ${hash}`);

  // Mark persistent session as started
  const waiters = startPersistentSession(hash, newSession.id, socket);

  // Notify the teacher FIRST
  // Use a separate message type to ensure different handling on client
  socket.send(JSON.stringify({
    type: 'teacher-authenticated',
    sessionId: newSession.id,
  }));

  // Immediately notify all OTHER waiters that the session has started
  // Since these are separate WebSocket connections, message ordering is guaranteed
  // within each connection (teacher gets 'teacher-authenticated', students get 'session-started')
  for (const waiter of waiters) {
    if (waiter !== socket && waiter.readyState === 1) { // 1 = OPEN
      waiter.send(JSON.stringify({
        type: 'session-started',
        sessionId: newSession.id,
      }));
    }
  }
  
  console.log(`Started persistent session ${hash} -> ${newSession.id}, notified ${waiters.length} waiters`);
}

/**
 * Broadcast the current waiter count to all waiters
 * @param {string} hash - The persistent hash
 * @param {object} session - The persistent session data
 */
function broadcastWaiterCount(hash, session) {
  if (!session || !session.waiters) return;
  
  const count = getWaiterCount(hash);
  const message = JSON.stringify({
    type: 'waiter-count',
    count,
  });

  for (const waiter of session.waiters) {
    if (waiter.readyState === 1) { // 1 = OPEN
      waiter.send(message);
    }
  }
}
