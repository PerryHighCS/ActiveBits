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
  hashTeacherCode,
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
  const socketId = socket._socket?.remoteAddress + ':' + socket._socket?.remotePort || 'unknown';
  
  // Rate limiting check
  if (!canAttemptTeacherCode(socketId)) {
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: 'Too many attempts. Please wait a minute.',
    }));
    return;
  }

  recordTeacherCodeAttempt(socketId);

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
  const isValid = verifyTeacherCodeWithHash(persistentSession.activityName, hash, teacherCode);
  
  if (!isValid) {
    console.log(`Invalid teacher code attempt for hash ${hash}, activity ${persistentSession.activityName}`);
    socket.send(JSON.stringify({
      type: 'teacher-code-error',
      error: 'Invalid teacher code',
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

  // Notify the teacher FIRST (before any other messages)
  socket.send(JSON.stringify({
    type: 'teacher-authenticated',
    sessionId: newSession.id,
  }));

  // Small delay to ensure teacher message is processed first
  setTimeout(() => {
    // Notify all OTHER waiters that the session has started
    for (const waiter of waiters) {
      if (waiter !== socket && waiter.readyState === 1) { // 1 = OPEN
        waiter.send(JSON.stringify({
          type: 'session-started',
          sessionId: newSession.id,
        }));
      }
    }
    console.log(`Started persistent session ${hash} -> ${newSession.id}, notified ${waiters.length} waiters`);
  }, 10);
}

/**
 * Broadcast the current waiter count to all waiters
 * @param {string} hash - The persistent hash
 * @param {object} session - The persistent session data
 */
function broadcastWaiterCount(hash, session) {
  if (!session) return;
  
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
