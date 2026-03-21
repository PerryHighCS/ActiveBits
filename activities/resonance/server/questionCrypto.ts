/**
 * Question payload encryption for Resonance persistent links.
 *
 * Questions are serialized → compressed (deflate) → encrypted (AES-256-GCM)
 * → base64url encoded for URL transport. The persistent-link hash is used as
 * authenticated associated data (AAD) to bind the ciphertext to its URL.
 *
 * This is obscuration, not long-term secure storage. The same
 * PERSISTENT_SESSION_SECRET used by the rest of the server is used as the
 * key source so a single environment variable covers all needs.
 *
 * Do not invent new shared crypto abstractions from this module unless a
 * second activity needs the same pattern.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { resolvePersistentSessionSecret } from 'activebits-server/core/persistentSessions.js'
import { validateQuestionSet } from '../shared/validation.js'
import type { Question } from '../shared/types.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_DERIVATION_CONTEXT = 'resonance-question-encryption-v1'

/**
 * Maximum allowed length (chars) for the base64url-encoded payload in a URL
 * query parameter. Keeping this conservative guards against server/proxy
 * query-string length limits and avoids oversized copy-paste URLs.
 */
export const MAX_ENCODED_PAYLOAD_CHARS = 3500
const MAX_DECODED_PAYLOAD_BYTES = Math.ceil((MAX_ENCODED_PAYLOAD_CHARS * 3) / 4)
const MAX_INFLATED_JSON_BYTES = 64 * 1024

function deriveKey(): Buffer {
  const secret = resolvePersistentSessionSecret()
  // HMAC-SHA256 of the context string gives us a 32-byte key for AES-256.
  return createHmac('sha256', secret).update(KEY_DERIVATION_CONTEXT).digest()
}

export interface EncryptResult {
  encoded: string
  sizeChars: number
}

/**
 * Encrypt a question array into a URL-safe encoded string.
 * The `hash` is bound to the ciphertext as AAD so the payload cannot be
 * transplanted to a different link.
 */
export function encryptQuestions(questions: Question[], hash: string): EncryptResult {
  const key = deriveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(hash, 'utf8'))

  const json = JSON.stringify(questions)
  const compressed = deflateSync(Buffer.from(json, 'utf8'), { level: 9 })

  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Layout: iv (12 bytes) | authTag (16 bytes) | ciphertext
  const combined = Buffer.concat([iv, authTag, ciphertext])
  const encoded = combined.toString('base64url')

  return { encoded, sizeChars: encoded.length }
}

/**
 * Decrypt a payload produced by `encryptQuestions`.
 * Returns the question array or `null` if authentication fails or the
 * payload is malformed.
 */
export function decryptQuestions(encoded: string, hash: string): Question[] | null {
  if (encoded.length > MAX_ENCODED_PAYLOAD_CHARS) {
    return null
  }

  let combined: Buffer
  try {
    combined = Buffer.from(encoded, 'base64url')
  } catch {
    return null
  }

  if (combined.length > MAX_DECODED_PAYLOAD_BYTES) {
    return null
  }

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    return null
  }

  const iv = combined.subarray(0, IV_LENGTH)
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const key = deriveKey()

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    decipher.setAAD(Buffer.from(hash, 'utf8'))

    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const json = inflateSync(compressed, { maxOutputLength: MAX_INFLATED_JSON_BYTES }).toString('utf8')
    const parsed: unknown = JSON.parse(json)
    const { questions, errors } = validateQuestionSet(parsed)
    if (errors.length > 0) return null
    return questions
  } catch {
    return null
  }
}
