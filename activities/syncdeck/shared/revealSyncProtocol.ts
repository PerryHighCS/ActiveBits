export const REVEAL_SYNC_PROTOCOL_VERSION = '2.0.0'

export interface RevealSyncProtocolCompatibility {
  compatible: boolean
  expectedVersion: string
  receivedVersion: string | null
  reason: 'compatible' | 'missing-version' | 'invalid-version' | 'major-mismatch'
}

function parseSemverMajor(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const [major] = trimmed.split('.')
  if (!major || !/^\d+$/.test(major)) {
    return null
  }

  const parsed = Number(major)
  return Number.isFinite(parsed) ? parsed : null
}

export function assessRevealSyncProtocolCompatibility(version: unknown): RevealSyncProtocolCompatibility {
  if (typeof version !== 'string') {
    return {
      compatible: false,
      expectedVersion: REVEAL_SYNC_PROTOCOL_VERSION,
      receivedVersion: null,
      reason: 'missing-version',
    }
  }

  const hostMajor = parseSemverMajor(REVEAL_SYNC_PROTOCOL_VERSION)
  const receivedMajor = parseSemverMajor(version)
  if (hostMajor == null || receivedMajor == null) {
    return {
      compatible: false,
      expectedVersion: REVEAL_SYNC_PROTOCOL_VERSION,
      receivedVersion: version,
      reason: 'invalid-version',
    }
  }

  if (hostMajor !== receivedMajor) {
    return {
      compatible: false,
      expectedVersion: REVEAL_SYNC_PROTOCOL_VERSION,
      receivedVersion: version,
      reason: 'major-mismatch',
    }
  }

  return {
    compatible: true,
    expectedVersion: REVEAL_SYNC_PROTOCOL_VERSION,
    receivedVersion: version,
    reason: 'compatible',
  }
}
