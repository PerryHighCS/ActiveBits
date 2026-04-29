import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityConfig } from '../types/activity.js'
import {
  activityUsesControlAuthority,
  claimSessionControlAuthority,
  getEmbeddedParentSessionId,
  getResolvedControlAuthorityOwnerInstanceId,
  getSessionControlAuthorityState,
  isInstructorControlOwner,
  normalizeInstructorInstanceId,
  normalizeSessionControlAuthorityState,
  resolveControlAuthority,
  setSessionControlAuthorityState,
  shouldAutoClaimControlAuthority,
} from './controlAuthority.js'

function buildActivityConfig(overrides: Partial<ActivityConfig> = {}): ActivityConfig {
  return {
    id: 'activity',
    name: 'Activity',
    description: 'desc',
    color: 'blue',
    standaloneEntry: {
      enabled: false,
      supportsDirectPath: false,
      supportsPermalink: false,
      showOnHome: false,
    },
    ...overrides,
  }
}

void test('normalizeSessionControlAuthorityState normalizes sparse and invalid input', () => {
  assert.deepEqual(normalizeSessionControlAuthorityState(null), {
    mode: 'single-instructor',
    ownerInstanceId: null,
    ownerTakenAt: null,
    overrideInherited: false,
  })

  assert.deepEqual(
    normalizeSessionControlAuthorityState({
      ownerInstanceId: '  inst-1  ',
      ownerTakenAt: 123,
      overrideInherited: true,
    }),
    {
      mode: 'single-instructor',
      ownerInstanceId: 'inst-1',
      ownerTakenAt: 123,
      overrideInherited: true,
    },
  )
})

void test('normalizeInstructorInstanceId trims usable instance ids only', () => {
  assert.equal(normalizeInstructorInstanceId('  inst-1  '), 'inst-1')
  assert.equal(normalizeInstructorInstanceId('   '), null)
  assert.equal(normalizeInstructorInstanceId(null), null)
})

void test('getSessionControlAuthorityState reads normalized state from session data', () => {
  assert.deepEqual(
    getSessionControlAuthorityState({
      data: {
        controlAuthority: {
          ownerInstanceId: 'owner-1',
          ownerTakenAt: 456,
          overrideInherited: false,
        },
      },
    }),
    {
      mode: 'single-instructor',
      ownerInstanceId: 'owner-1',
      ownerTakenAt: 456,
      overrideInherited: false,
    },
  )
})

void test('setSessionControlAuthorityState persists normalized authority state into session data', () => {
  const session = { data: {} }
  const storedState = setSessionControlAuthorityState(session, {
    mode: 'single-instructor',
    ownerInstanceId: 'owner-1',
    ownerTakenAt: 789,
    overrideInherited: true,
  })

  assert.deepEqual(storedState, {
    mode: 'single-instructor',
    ownerInstanceId: 'owner-1',
    ownerTakenAt: 789,
    overrideInherited: true,
  })
  assert.deepEqual((session.data as Record<string, unknown>).controlAuthority, storedState)
})

void test('claimSessionControlAuthority stores the active owner and timestamp', () => {
  const session = { data: {} }

  const claimedState = claimSessionControlAuthority({
    session,
    instructorInstanceId: '  owner-2  ',
    takenAt: 999,
  })

  assert.deepEqual(claimedState, {
    mode: 'single-instructor',
    ownerInstanceId: 'owner-2',
    ownerTakenAt: 999,
    overrideInherited: false,
  })
})

void test('getEmbeddedParentSessionId returns trimmed embedded parent ids only', () => {
  assert.equal(getEmbeddedParentSessionId(null), null)
  assert.equal(getEmbeddedParentSessionId({ id: 'child', data: {} }), null)
  assert.equal(
    getEmbeddedParentSessionId({
      id: 'child',
      data: { embeddedParentSessionId: '  parent-1  ' },
    }),
    'parent-1',
  )
})

void test('activityUsesControlAuthority only enables configured single-instructor activities', () => {
  assert.equal(activityUsesControlAuthority(buildActivityConfig()), false)
  assert.equal(
    activityUsesControlAuthority(
      buildActivityConfig({
        controlAuthority: {
          mode: 'single-instructor',
        },
      }),
    ),
    true,
  )
})

void test('resolveControlAuthority uses local session authority by default', () => {
  const activityConfig = buildActivityConfig({
    controlAuthority: {
      mode: 'single-instructor',
      scope: 'session',
    },
  })

  assert.deepEqual(
    resolveControlAuthority({
      session: { id: 'session-1', data: {} },
      activityConfig,
    }),
    {
      mode: 'single-instructor',
      configuredScope: 'session',
      effectiveScope: 'session',
      authoritySessionId: 'session-1',
      inheritedFromSessionId: null,
    },
  )
})

void test('resolveControlAuthority inherits parent authority for embedded sessions when configured', () => {
  const childConfig = buildActivityConfig({
    controlAuthority: {
      mode: 'single-instructor',
      scope: 'inherited',
    },
  })
  const parentConfig = buildActivityConfig({
    id: 'syncdeck',
    name: 'SyncDeck',
    controlAuthority: {
      mode: 'single-instructor',
      scope: 'session',
    },
  })

  assert.deepEqual(
    resolveControlAuthority({
      session: {
        id: 'child-1',
        data: { embeddedParentSessionId: 'parent-1' },
      },
      activityConfig: childConfig,
      parentSession: {
        id: 'parent-1',
        data: {},
      },
      parentActivityConfig: parentConfig,
    }),
    {
      mode: 'single-instructor',
      configuredScope: 'inherited',
      effectiveScope: 'inherited',
      authoritySessionId: 'parent-1',
      inheritedFromSessionId: 'parent-1',
    },
  )
})

void test('resolveControlAuthority falls back to local session authority without a controlling parent', () => {
  const childConfig = buildActivityConfig({
    controlAuthority: {
      mode: 'single-instructor',
      scope: 'inherited',
    },
  })

  assert.deepEqual(
    resolveControlAuthority({
      session: {
        id: 'child-1',
        data: { embeddedParentSessionId: 'missing-parent' },
      },
      activityConfig: childConfig,
      parentSession: null,
      parentActivityConfig: null,
    }),
    {
      mode: 'single-instructor',
      configuredScope: 'inherited',
      effectiveScope: 'session',
      authoritySessionId: 'child-1',
      inheritedFromSessionId: null,
    },
  )
})

void test('resolveControlAuthority falls back to local session authority when inherited control is locally overridden', () => {
  const childConfig = buildActivityConfig({
    controlAuthority: {
      mode: 'single-instructor',
      scope: 'inherited',
    },
  })
  const parentConfig = buildActivityConfig({
    id: 'syncdeck',
    name: 'SyncDeck',
    controlAuthority: {
      mode: 'single-instructor',
    },
  })

  assert.deepEqual(
    resolveControlAuthority({
      session: {
        id: 'child-1',
        data: {
          embeddedParentSessionId: 'parent-1',
          controlAuthority: {
            overrideInherited: true,
          },
        },
      },
      activityConfig: childConfig,
      parentSession: {
        id: 'parent-1',
        data: {},
      },
      parentActivityConfig: parentConfig,
    }),
    {
      mode: 'single-instructor',
      configuredScope: 'inherited',
      effectiveScope: 'session',
      authoritySessionId: 'child-1',
      inheritedFromSessionId: null,
    },
  )
})

void test('resolveControlAuthority returns null for activities without control authority configured', () => {
  assert.equal(
    resolveControlAuthority({
      session: { id: 'session-1', data: {} },
      activityConfig: buildActivityConfig(),
    }),
    null,
  )
})

void test('getResolvedControlAuthorityOwnerInstanceId reads from the effective authority session', () => {
  const inheritedResolution = {
    mode: 'single-instructor',
    configuredScope: 'inherited',
    effectiveScope: 'inherited',
    authoritySessionId: 'parent-1',
    inheritedFromSessionId: 'parent-1',
  } as const

  assert.equal(
    getResolvedControlAuthorityOwnerInstanceId({
      resolvedAuthority: inheritedResolution,
      session: { data: { controlAuthority: { ownerInstanceId: 'child-owner' } } },
      parentSession: { data: { controlAuthority: { ownerInstanceId: 'parent-owner' } } },
    }),
    'parent-owner',
  )

  assert.equal(
    getResolvedControlAuthorityOwnerInstanceId({
      resolvedAuthority: {
        mode: 'single-instructor',
        configuredScope: 'session',
        effectiveScope: 'session',
        authoritySessionId: 'child-1',
        inheritedFromSessionId: null,
      },
      session: { data: { controlAuthority: { ownerInstanceId: 'child-owner' } } },
      parentSession: { data: { controlAuthority: { ownerInstanceId: 'parent-owner' } } },
    }),
    'child-owner',
  )
})

void test('isInstructorControlOwner compares the instructor instance id against the effective owner', () => {
  const resolvedAuthority = {
    mode: 'single-instructor',
    configuredScope: 'session',
    effectiveScope: 'session',
    authoritySessionId: 'session-1',
    inheritedFromSessionId: null,
  } as const

  assert.equal(
    isInstructorControlOwner({
      resolvedAuthority,
      session: { data: { controlAuthority: { ownerInstanceId: 'owner-1' } } },
      instructorInstanceId: 'owner-1',
    }),
    true,
  )
  assert.equal(
    isInstructorControlOwner({
      resolvedAuthority,
      session: { data: { controlAuthority: { ownerInstanceId: 'owner-1' } } },
      instructorInstanceId: 'owner-2',
    }),
    false,
  )
})

void test('shouldAutoClaimControlAuthority is true only when the effective owner is empty', () => {
  const resolvedAuthority = {
    mode: 'single-instructor',
    configuredScope: 'session',
    effectiveScope: 'session',
    authoritySessionId: 'session-1',
    inheritedFromSessionId: null,
  } as const

  assert.equal(
    shouldAutoClaimControlAuthority({
      resolvedAuthority,
      session: { data: {} },
    }),
    true,
  )
  assert.equal(
    shouldAutoClaimControlAuthority({
      resolvedAuthority,
      session: { data: { controlAuthority: { ownerInstanceId: 'owner-1' } } },
    }),
    false,
  )
})
