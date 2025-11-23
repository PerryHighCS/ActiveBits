import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Persistent Session Management
 * 
 * Uses HMAC-based verification so no server-side storage is needed.
 * The hash is generated from activityName + hashedTeacherCode + salt, and can be verified without storage.
 */

// In-memory active sessions (only while waiting/active): hash -> { waiters, sessionId, ... }
const activePersistentSessions = new Map();

// Rate limiting for teacher code attempts: socketId -> { attempts, lastAttempt }
const teacherCodeAttempts = new Map();

const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const WAITER_TIMEOUT = 600000; // 10 minutes
const CLEANUP_INTERVAL = 60000; // 1 minute

// Secret for HMAC (MUST be set in production via environment variable)
const HMAC_SECRET = process.env.PERSISTENT_SESSION_SECRET || 'default-secret-change-in-production';

// Security check: warn if using default secret in production or if secret is weak
const weakSecrets = [
  'secret', 'password', '12345', 'changeme', 'default', 'admin', 'letmein', 'qwerty',
  'default-secret-change-in-production'
];
const envSecret = process.env.PERSISTENT_SESSION_SECRET;
if (!envSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('⚠️  SECURITY WARNING: PERSISTENT_SESSION_SECRET is not set in production!');
    console.error('⚠️  Using default HMAC secret is a security risk.');
    console.error('⚠️  Set PERSISTENT_SESSION_SECRET environment variable immediately.');
  } else {
    console.warn('⚠️  Development mode: Using default HMAC secret. Set PERSISTENT_SESSION_SECRET for production.');
  }
} else {
  if (envSecret.length < 32) {
    console.warn('⚠️  SECURITY WARNING: PERSISTENT_SESSION_SECRET is less than 32 characters. Use a longer, randomly generated secret for production.');
  }
  if (weakSecrets.includes(envSecret.toLowerCase())) {
    console.warn('⚠️  SECURITY WARNING: PERSISTENT_SESSION_SECRET appears to be a weak or default value. Choose a strong, unique secret.');
  }
}

/**
 * Hash a teacher code using SHA-256
 * @param {string} teacherCode - The teacher code to hash
 * @returns {string} - The hashed teacher code (hex)
 */
export function hashTeacherCode(teacherCode) {
  return createHash('sha256').update(teacherCode).digest('hex');
}

/**
 * Generate a persistent hash with embedded salt for uniqueness
 * Format: hash is derived from activityName|hashedTeacherCode|salt
 * The salt is embedded in the hash itself (first 8 chars)
 * @param {string} activityName - The activity name
 * @param {string} teacherCode - The teacher code
 * @returns {object} - { hash, activityName, hashedTeacherCode }
 */
export function generatePersistentHash(activityName, teacherCode) {
  const hashedTeacherCode = hashTeacherCode(teacherCode);
  const salt = randomBytes(4).toString('hex'); // 8 character hex salt
  const payload = `${activityName}|${hashedTeacherCode}|${salt}`;
  const hmac = createHmac('sha256', HMAC_SECRET).update(payload).digest('hex').substring(0, 12);
  
  // Combine salt + hmac to create the final hash (salt is first 8 chars, hmac is next 12)
  const hash = salt + hmac;
  
  return {
    hash,
    activityName,
    hashedTeacherCode,
  };
}

/**
 * Extract salt from hash and verify teacher code
 * @param {string} activityName - The activity name
 * @param {string} hash - The persistent hash (salt+hmac)
 * @param {string} teacherCode - The teacher code to verify
 * @returns {object} - { valid: boolean, error?: string }
 */
export function verifyTeacherCodeWithHash(activityName, hash, teacherCode) {
  if (hash.length !== 20) {
    const error = `Invalid link format (corrupted URL). Expected 20 characters, got ${hash.length}.`;
    console.log(`Hash validation failed: ${error}`);
    return { valid: false, error };
  }
  
  const salt = hash.substring(0, 8);
  const expectedHmac = hash.substring(8);
  
  const hashedTeacherCode = hashTeacherCode(teacherCode);
  const payload = `${activityName}|${hashedTeacherCode}|${salt}`;
  const computedHmac = createHmac('sha256', HMAC_SECRET).update(payload).digest('hex').substring(0, 12);
  
  // Use constant-time comparison to prevent timing-based side-channel attacks
  // Convert hex strings to buffers for timingSafeEqual
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');
  const computedBuffer = Buffer.from(computedHmac, 'hex');
  
  try {
    if (!timingSafeEqual(expectedBuffer, computedBuffer)) {
      return { valid: false, error: 'Invalid teacher code' };
    }
  } catch (err) {
    // timingSafeEqual throws if buffers have different lengths
    return { valid: false, error: 'Invalid teacher code' };
  }
  
  return { valid: true };
}

/**
 * Create or get an active persistent session (in-memory while people are waiting)
 * @param {string} activityName - The activity name
 * @param {string} hash - The persistent hash
 * @param {string} hashedTeacherCode - The hashed teacher code (optional, for verification)
 */
export function getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode = null) {
  let session = activePersistentSessions.get(hash);
  
  if (!session) {
    session = {
      activityName,
      hashedTeacherCode,
      waiters: [],
      createdAt: Date.now(),
      sessionId: null,
      teacherSocketId: null,
    };
    activePersistentSessions.set(hash, session);
    
    // Start cleanup timer if this is the first session
    ensureCleanupTimer();
  }
  
  // Update hashed teacher code if provided
  if (hashedTeacherCode && !session.hashedTeacherCode) {
    session.hashedTeacherCode = hashedTeacherCode;
  }
  
  return session;
}

/**
 * Get a persistent session by hash
 * @param {string} hash - The persistent hash
 * @returns {object|undefined} - The session data or undefined
 */
export function getPersistentSession(hash) {
  return activePersistentSessions.get(hash);
}

/**
 * Add a waiter to a persistent session
 * @param {string} hash - The persistent hash
 * @param {object} ws - The WebSocket connection
 * @returns {number} - The new waiter count
 */
export function addWaiter(hash, ws) {
  const session = activePersistentSessions.get(hash);
  if (!session) return 0;

  // Remove if already waiting (reconnection)
  session.waiters = session.waiters.filter(w => w !== ws);
  
  session.waiters.push(ws);
  return session.waiters.length;
}

/**
 * Remove a waiter from a persistent session
 * @param {string} hash - The persistent hash
 * @param {object} ws - The WebSocket connection
 */
export function removeWaiter(hash, ws) {
  const session = activePersistentSessions.get(hash);
  if (!session) return;
  
  session.waiters = session.waiters.filter(w => w !== ws);
}

/**
 * Get the number of waiters in a persistent session
 * @param {string} hash - The persistent hash
 * @returns {number} - The waiter count
 */
export function getWaiterCount(hash) {
  const session = activePersistentSessions.get(hash);
  return session ? session.waiters.length : 0;
}

/**
 * Check if a socket can attempt to enter a teacher code
 * Uses IP+hash combination to prevent shared IP false positives
 * @param {string} rateLimitKey - The rate limit key (e.g., "IP:hash")
 * @returns {boolean} - True if allowed, false if rate limited
 */
export function canAttemptTeacherCode(rateLimitKey) {
  const record = teacherCodeAttempts.get(rateLimitKey);
  if (!record) return true;

  const now = Date.now();
  if (now - record.lastAttempt > RATE_LIMIT_WINDOW) {
    teacherCodeAttempts.delete(rateLimitKey);
    return true;
  }

  return record.attempts < MAX_ATTEMPTS;
}

/**
 * Record a teacher code attempt
 * Uses IP+hash combination to prevent shared IP false positives
 * @param {string} rateLimitKey - The rate limit key (e.g., "IP:hash")
 */
export function recordTeacherCodeAttempt(rateLimitKey) {
  const record = teacherCodeAttempts.get(rateLimitKey);
  const now = Date.now();

  if (!record || now - record.lastAttempt > RATE_LIMIT_WINDOW) {
    teacherCodeAttempts.set(rateLimitKey, { attempts: 1, lastAttempt: now });
  } else {
    record.attempts++;
    record.lastAttempt = now;
  }
}

/**
 * Start a persistent session (called when teacher authenticates)
 * @param {string} hash - The persistent hash
 * @param {string} sessionId - The actual session ID that was created
 * @param {object} teacherWs - The teacher's WebSocket connection
 * @returns {object[]} - Array of waiter WebSocket connections
 */
export function startPersistentSession(hash, sessionId, teacherWs) {
  const session = activePersistentSessions.get(hash);
  if (!session) return [];

  session.sessionId = sessionId;
  session.teacherSocketId = teacherWs.id;

  // Return copy of waiters array
  return [...session.waiters];
}

/**
 * Check if a persistent session has been started
 * @param {string} hash - The persistent hash
 * @returns {boolean} - True if started, false otherwise
 */
export function isSessionStarted(hash) {
  const session = activePersistentSessions.get(hash);
  return session?.sessionId != null;
}

/**
 * Get the session ID for a started persistent session
 * @param {string} hash - The persistent hash
 * @returns {string|null} - The session ID or null
 */
export function getSessionId(hash) {
  return activePersistentSessions.get(hash)?.sessionId ?? null;
}

/**
 * Reset a persistent session (clear sessionId but keep the session for reuse)
 * This allows the persistent link to be reused after ending a session
 * @param {string} hash - The persistent hash
 */
export function resetPersistentSession(hash) {
  const session = activePersistentSessions.get(hash);
  if (session) {
    session.sessionId = null;
    session.teacherSocketId = null;
    // Keep waiters array and other data for reuse
  }
}

/**
 * Find hash by sessionId (for cleanup when session ends)
 * @param {string} sessionId - The session ID
 * @returns {string|null} - The hash or null
 */
export function findHashBySessionId(sessionId) {
  for (const [hash, session] of activePersistentSessions.entries()) {
    if (session.sessionId === sessionId) {
      return hash;
    }
  }
  return null;
}

/**
 * Clean up a persistent session
 * @param {string} hash - The persistent hash
 */
export function cleanupPersistentSession(hash) {
  activePersistentSessions.delete(hash);
  
  // Stop cleanup timer if no active sessions
  if (activePersistentSessions.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Cleanup timer reference (started on-demand)
let cleanupTimer = null;

/**
 * Ensure cleanup timer is running
 */
function ensureCleanupTimer() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      
      for (const [hash, session] of activePersistentSessions.entries()) {
        // For sessions that haven't started, check if they're old and empty
        if (!session.sessionId && session.waiters.length === 0 && now - session.createdAt > WAITER_TIMEOUT) {
          activePersistentSessions.delete(hash);
        }
      }
      
      // Stop timer if no sessions remain
      if (activePersistentSessions.size === 0) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    }, CLEANUP_INTERVAL);
    
    // Don't keep the event loop alive just for cleanup
    cleanupTimer.unref();
  }
}
