import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ValkeyPersistentStore } from './valkeyStore.js';

/**
 * Persistent Session Management
 * 
 * Uses HMAC-based verification so no server-side storage is needed.
 * The hash is generated from activityName + hashedTeacherCode + salt, and can be verified without storage.
 */

// Storage backend (either in-memory Map or Valkey)
let persistentStore = null;

// In-memory cache for persistent session metadata (reduces Valkey reads)
const persistentCache = new Map(); // hash -> session metadata

// In-memory waiters tracking (WebSockets are instance-specific, never stored in Valkey)
const waitersByHash = new Map(); // hash -> WebSocket[]

const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const WAITER_TIMEOUT = 600000; // 10 minutes
const CLEANUP_INTERVAL = 60000; // 1 minute

// Secret for HMAC (MUST be set in production via environment variable)
const HMAC_SECRET = process.env.PERSISTENT_SESSION_SECRET || 'default-secret-change-in-production';

/**
 * Initialize persistent session storage backend.
 * @param {Object|null} valkeyClient - Valkey client instance (null for in-memory)
 */
export function initializePersistentStorage(valkeyClient = null) {
  if (valkeyClient) {
    console.log('Using Valkey for persistent session metadata');
    persistentStore = new ValkeyPersistentStore(valkeyClient);
  } else {
    console.log('Using in-memory storage for persistent session metadata');
    // In-memory store compatible with Valkey API
    const memoryStore = new Map();
    persistentStore = {
      async get(hash) { return memoryStore.get(hash) || null; },
      async set(hash, data) { memoryStore.set(hash, data); },
      async delete(hash) { memoryStore.delete(hash); },
      async getAllHashes() { return Array.from(memoryStore.keys()); },
      async incrementAttempts(key) {
        const current = memoryStore.get(`rl:${key}`) || 0;
        memoryStore.set(`rl:${key}`, current + 1);
        setTimeout(() => memoryStore.delete(`rl:${key}`), 60000);
        return current + 1;
      },
      async getAttempts(key) {
        return memoryStore.get(`rl:${key}`) || 0;
      }
    };
  }
  
  // Start cleanup timer
  ensureCleanupTimer();
}

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
 * Create or get an active persistent session
 * @param {string} activityName - The activity name
 * @param {string} hash - The persistent hash
 * @param {string} hashedTeacherCode - The hashed teacher code (optional, for verification)
 */
export async function getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode = null) {
  // Check cache first
  let session = persistentCache.get(hash);
  
  if (!session) {
    // Cache miss - check persistent store
    session = await persistentStore.get(hash);
    
    if (!session) {
      session = {
        activityName,
        hashedTeacherCode,
        createdAt: Date.now(),
        sessionId: null,
        teacherSocketId: null,
      };
      await persistentStore.set(hash, session);
      
      // Initialize waiter array (instance-specific, not stored)
      waitersByHash.set(hash, []);
      
      // Start cleanup timer if this is the first session
      ensureCleanupTimer();
    } else if (!waitersByHash.has(hash)) {
      // Metadata exists in store but no local waiters yet
      waitersByHash.set(hash, []);
    }
    
    // Cache the session
    persistentCache.set(hash, session);
  } else if (!waitersByHash.has(hash)) {
    // Cached but no waiters array yet
    waitersByHash.set(hash, []);
  }
  
  // Update hashed teacher code if provided
  if (hashedTeacherCode && !session.hashedTeacherCode) {
    session.hashedTeacherCode = hashedTeacherCode;
    await persistentStore.set(hash, session);
    persistentCache.set(hash, session); // Update cache
  }
  
  return session;
}

/**
 * Get a persistent session by hash
 * @param {string} hash - The persistent hash
 * @returns {Promise<object|null>} - The session data or null
 */
export async function getPersistentSession(hash) {
  // Check cache first
  let session = persistentCache.get(hash);
  if (!session) {
    session = await persistentStore.get(hash);
    if (session) {
      persistentCache.set(hash, session);
    }
  }
  return session;
}

/**
 * Add a waiter to a persistent session
 * @param {string} hash - The persistent hash
 * @param {object} ws - The WebSocket connection
 * @returns {number} - The new waiter count
 */
export function addWaiter(hash, ws) {
  let waiters = waitersByHash.get(hash);
  if (!waiters) {
    waiters = [];
    waitersByHash.set(hash, waiters);
  }

  // Remove if already waiting (reconnection)
  const filtered = waiters.filter(w => w !== ws);
  filtered.push(ws);
  waitersByHash.set(hash, filtered);
  
  return filtered.length;
}

/**
 * Remove a waiter from a persistent session
 * @param {string} hash - The persistent hash
 * @param {object} ws - The WebSocket connection
 */
export function removeWaiter(hash, ws) {
  const waiters = waitersByHash.get(hash);
  if (!waiters) return;
  
  waitersByHash.set(hash, waiters.filter(w => w !== ws));
}

/**
 * Get the number of waiters in a persistent session
 * @param {string} hash - The persistent hash
 * @returns {number} - The waiter count
 */
export function getWaiterCount(hash) {
  const waiters = waitersByHash.get(hash);
  return waiters ? waiters.length : 0;
}

/**
 * Get waiters array for a hash (for broadcasting)
 * @param {string} hash - The persistent hash
 * @returns {Array} - Array of WebSocket connections
 */
export function getWaiters(hash) {
  return waitersByHash.get(hash) || [];
}

/**
 * Check if a socket can attempt to enter a teacher code
 * Uses IP+hash combination to prevent shared IP false positives
 * @param {string} rateLimitKey - The rate limit key (e.g., "IP:hash")
 * @returns {Promise<boolean>} - True if allowed, false if rate limited
 */
export async function canAttemptTeacherCode(rateLimitKey) {
  const attempts = await persistentStore.getAttempts(rateLimitKey);
  return attempts < MAX_ATTEMPTS;
}

/**
 * Record a teacher code attempt
 * Uses IP+hash combination to prevent shared IP false positives
 * @param {string} rateLimitKey - The rate limit key (e.g., "IP:hash")
 */
export async function recordTeacherCodeAttempt(rateLimitKey) {
  await persistentStore.incrementAttempts(rateLimitKey);
}

/**
 * Start a persistent session (called when teacher authenticates)
 * @param {string} hash - The persistent hash
 * @param {string} sessionId - The actual session ID that was created
 * @param {object} teacherWs - The teacher's WebSocket connection
 * @returns {Promise<object[]>} - Array of waiter WebSocket connections
 */
export async function startPersistentSession(hash, sessionId, teacherWs) {
  const session = await getPersistentSession(hash);
  if (!session) return [];

  session.sessionId = sessionId;
  session.teacherSocketId = teacherWs.id;
  await persistentStore.set(hash, session);
  persistentCache.set(hash, session); // Update cache

  // Return copy of waiters array (instance-local)
  const waiters = waitersByHash.get(hash) || [];
  return [...waiters];
}

/**
 * Check if a persistent session has been started
 * @param {string} hash - The persistent hash
 * @returns {Promise<boolean>} - True if started, false otherwise
 */
export async function isSessionStarted(hash) {
  const session = await getPersistentSession(hash);
  return session?.sessionId != null;
}

/**
 * Get the session ID for a started persistent session
 * @param {string} hash - The persistent hash
 * @returns {Promise<string|null>} - The session ID or null
 */
export async function getSessionId(hash) {
  const session = await getPersistentSession(hash);
  return session?.sessionId ?? null;
}

/**
 * Reset a persistent session (clear sessionId but keep the session for reuse)
 * This allows the persistent link to be reused after ending a session
 * @param {string} hash - The persistent hash
 */
export async function resetPersistentSession(hash) {
  const session = await persistentStore.get(hash);
  if (session) {
    session.sessionId = null;
    session.teacherSocketId = null;
    await persistentStore.set(hash, session);
    // Keep waiters array (instance-local) for reuse
  }
}

/**
 * Find hash by sessionId (for cleanup when session ends)
 * @param {string} sessionId - The session ID
 * @returns {Promise<string|null>} - The hash or null
 */
export async function findHashBySessionId(sessionId) {
  const hashes = await persistentStore.getAllHashes();
  for (const hash of hashes) {
    const session = await persistentStore.get(hash);
    if (session?.sessionId === sessionId) {
      return hash;
    }
  }
  return null;
}

/**
 * Clean up a persistent session
 * @param {string} hash - The persistent hash
 */
export async function cleanupPersistentSession(hash) {
  await persistentStore.delete(hash);
  waitersByHash.delete(hash);
  
  // Stop cleanup timer if no active sessions
  const hashes = await persistentStore.getAllHashes();
  if (hashes.length === 0 && cleanupTimer) {
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
    cleanupTimer = setInterval(async () => {
      const now = Date.now();
      const hashes = await persistentStore.getAllHashes();
      
      for (const hash of hashes) {
        const session = await persistentStore.get(hash);
        const waiters = waitersByHash.get(hash) || [];
        
        // For sessions that haven't started, check if they're old and empty
        if (session && !session.sessionId && waiters.length === 0 && now - session.createdAt > WAITER_TIMEOUT) {
          await persistentStore.delete(hash);
          waitersByHash.delete(hash);
        }
      }
      
      // Stop timer if no sessions remain
      const remaining = await persistentStore.getAllHashes();
      if (remaining.length === 0) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    }, CLEANUP_INTERVAL);
    
    // Don't keep the event loop alive just for cleanup
    cleanupTimer.unref();
  }
}
