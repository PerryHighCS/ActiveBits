import test from 'node:test'
import assert from 'node:assert/strict'
import type { ComponentType } from 'react'
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
