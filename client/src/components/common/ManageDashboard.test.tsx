import test from 'node:test'
import assert from 'node:assert/strict'
import type { ComponentType } from 'react'
import {
  isPersistentLinkPreflightVerified,
  resolvePersistentLinkPreflightValue,
} from './manageDashboardUtils'
import { resolveCustomPersistentLinkBuilder } from './manageDashboardViewUtils'

function DummyBuilder(): null {
  return null
}

type DashboardActivityLike = Parameters<typeof resolveCustomPersistentLinkBuilder>[0]

void test('resolveCustomPersistentLinkBuilder returns null when no custom builder flag is enabled', () => {
  const activity = {
    manageDashboard: { customPersistentLinkBuilder: false },
    PersistentLinkBuilderComponent: DummyBuilder as ComponentType<unknown>,
  } satisfies NonNullable<DashboardActivityLike>

  assert.equal(resolveCustomPersistentLinkBuilder(activity), null)
})

void test('resolveCustomPersistentLinkBuilder returns null when flag is enabled but component is missing', () => {
  const activity = {
    manageDashboard: { customPersistentLinkBuilder: true },
    PersistentLinkBuilderComponent: null,
  } satisfies NonNullable<DashboardActivityLike>

  assert.equal(resolveCustomPersistentLinkBuilder(activity), null)
})

void test('resolveCustomPersistentLinkBuilder returns activity-owned builder when flag and component are present', () => {
  const activity = {
    manageDashboard: { customPersistentLinkBuilder: true },
    PersistentLinkBuilderComponent: DummyBuilder as ComponentType<unknown>,
  } satisfies NonNullable<DashboardActivityLike>

  assert.equal(resolveCustomPersistentLinkBuilder(activity), DummyBuilder)
})

void test('resolvePersistentLinkPreflightValue trims the configured option value only', () => {
  assert.equal(
    resolvePersistentLinkPreflightValue('presentationUrl', {
      presentationUrl: '  https://slides.example/deck  ',
      ignored: ' value ',
    }),
    'https://slides.example/deck',
  )
  assert.equal(resolvePersistentLinkPreflightValue('missing', { presentationUrl: 'https://slides.example/deck' }), '')
  assert.equal(resolvePersistentLinkPreflightValue(null, { presentationUrl: 'https://slides.example/deck' }), '')
})

void test('isPersistentLinkPreflightVerified matches the submit-time preflight rule', () => {
  assert.equal(
    isPersistentLinkPreflightVerified(
      'presentationUrl',
      { presentationUrl: 'https://slides.example/deck' },
      'https://slides.example/deck',
    ),
    true,
  )
  assert.equal(
    isPersistentLinkPreflightVerified(
      'presentationUrl',
      { presentationUrl: 'https://slides.example/updated' },
      'https://slides.example/deck',
    ),
    false,
  )
  assert.equal(
    isPersistentLinkPreflightVerified(
      'presentationUrl',
      { presentationUrl: '' },
      null,
    ),
    true,
  )
  assert.equal(
    isPersistentLinkPreflightVerified(
      null,
      { presentationUrl: 'https://slides.example/deck' },
      null,
    ),
    true,
  )
})
