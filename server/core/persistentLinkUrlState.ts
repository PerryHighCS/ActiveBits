import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PersistentSessionEntryPolicy } from '../../types/waitingRoom.js'
import { resolvePersistentSessionSecret } from './persistentSessions.js'

const HMAC_SECRET = resolvePersistentSessionSecret()

export interface PersistentLinkUrlState {
  entryPolicy: PersistentSessionEntryPolicy
  selectedOptions: Record<string, string>
}

function toStringRecord(record: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {}

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        normalized[key] = trimmed
      }
      continue
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value)
    }
  }

  return normalized
}

export function normalizePersistentLinkSelectedOptions(selectedOptions: Record<string, unknown>): Record<string, string> {
  return toStringRecord(selectedOptions)
}

function buildCanonicalPersistentLinkStatePayload({
  entryPolicy,
  selectedOptions,
}: PersistentLinkUrlState): string {
  const params = new URLSearchParams()
  params.set('entryPolicy', entryPolicy)

  for (const key of Object.keys(selectedOptions).sort()) {
    params.set(key, selectedOptions[key] ?? '')
  }

  return params.toString()
}

export function computePersistentLinkUrlHash(
  persistentHash: string,
  state: PersistentLinkUrlState,
): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(`${persistentHash}|${buildCanonicalPersistentLinkStatePayload(state)}`)
    .digest('hex')
    .substring(0, 16)
}

export function verifyPersistentLinkUrlHash(
  persistentHash: string,
  state: PersistentLinkUrlState,
  candidate: string,
): boolean {
  if (!/^[a-f0-9]{16}$/i.test(candidate)) {
    return false
  }

  const expected = computePersistentLinkUrlHash(persistentHash, state)
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'))
  } catch {
    return false
  }
}

export function buildPersistentLinkUrlQuery({
  hash,
  entryPolicy,
  selectedOptions,
}: {
  hash: string
  entryPolicy: PersistentSessionEntryPolicy
  selectedOptions: Record<string, unknown>
}): URLSearchParams {
  const normalizedSelectedOptions = normalizePersistentLinkSelectedOptions(selectedOptions)
  const state = {
    entryPolicy,
    selectedOptions: normalizedSelectedOptions,
  } satisfies PersistentLinkUrlState
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(normalizedSelectedOptions)) {
    params.set(key, value)
  }

  params.set('entryPolicy', entryPolicy)
  params.set('urlHash', computePersistentLinkUrlHash(hash, state))
  return params
}
