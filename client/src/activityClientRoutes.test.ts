import assert from 'node:assert/strict'
import test from 'node:test'
import type { ComponentType } from 'react'
import type { ActivityRegistryEntry } from '../../types/activity.js'
import { registerActivityClientRoutes } from './activityClientRoutes.js'

const RouteComponent: ComponentType<unknown> = () => null

function activity(
  id: string,
  routes: Array<{ id: string; path: string }>,
  components?: Record<string, ComponentType<unknown>>,
): ActivityRegistryEntry {
  return {
    id,
    name: id,
    description: id,
    color: 'blue',
    standaloneEntry: { enabled: false },
    clientRoutes: routes,
    ClientRouteComponents: components,
  }
}

void test('registerActivityClientRoutes registers a declared route with its component', () => {
  const routes = registerActivityClientRoutes([
    activity('syncdeck', [{ id: 'waiting-room', path: '/integrations/learn/syncdeck/wait' }], { 'waiting-room': RouteComponent }),
  ])

  assert.deepEqual(routes, [{
    activityId: 'syncdeck',
    id: 'waiting-room',
    path: '/integrations/learn/syncdeck/wait',
    Component: RouteComponent,
  }])
})

void test('registerActivityClientRoutes skips routes missing a component mapping', () => {
  const problems: string[] = []
  const routes = registerActivityClientRoutes(
    [activity('syncdeck', [{ id: 'waiting-room', path: '/integrations/learn/syncdeck/wait' }])],
    (message) => problems.push(message),
  )

  assert.deepEqual(routes, [])
  assert.deepEqual(problems, ['Skipping activity client route "/integrations/learn/syncdeck/wait" because "syncdeck" does not export "waiting-room".'])
})

void test('registerActivityClientRoutes keeps the first component for duplicate paths', () => {
  const problems: string[] = []
  const FirstComponent: ComponentType<unknown> = () => null
  const SecondComponent: ComponentType<unknown> = () => null
  const routes = registerActivityClientRoutes([
    activity('first', [{ id: 'route', path: '/activity-route' }], { route: FirstComponent }),
    activity('second', [{ id: 'route', path: '/activity-route' }], { route: SecondComponent }),
  ], (message) => problems.push(message))

  assert.equal(routes.length, 1)
  assert.equal(routes[0]?.Component, FirstComponent)
  assert.deepEqual(problems, ['Skipping duplicate activity client route "/activity-route" from "second".'])
})

void test('registerActivityClientRoutes does not let a missing mapping claim a later valid path', () => {
  const problems: string[] = []
  const routes = registerActivityClientRoutes([
    activity('missing', [{ id: 'route', path: '/activity-route' }]),
    activity('valid', [{ id: 'route', path: '/activity-route' }], { route: RouteComponent }),
  ], (message) => problems.push(message))

  assert.deepEqual(routes, [{ activityId: 'valid', id: 'route', path: '/activity-route', Component: RouteComponent }])
  assert.deepEqual(problems, ['Skipping activity client route "/activity-route" because "missing" does not export "route".'])
})
