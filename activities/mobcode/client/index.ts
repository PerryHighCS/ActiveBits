import { createElement, lazy, type ComponentProps } from 'react'
import type { ActivityPersistentSoloLaunchParams, ActivityPersistentSoloLaunchResult } from '../../../types/activity.js'

// The registry already renders activity components inside Suspense. Keeping the two role
// views lazy prevents one role's implementation from inflating the other's entry chunk.
const LazyManagerComponent = lazy(() => import('./manager/MobCodeManager'))
const LazyStudentComponent = lazy(() => import('./student/MobCodeStudent'))

function ManagerComponent() {
  return createElement(LazyManagerComponent)
}

function StudentComponent(props: ComponentProps<typeof LazyStudentComponent>) {
  return createElement(LazyStudentComponent, { sessionData: props.sessionData })
}

export async function launchMobCodePersistentSoloEntry(
  params: ActivityPersistentSoloLaunchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityPersistentSoloLaunchResult> {
  const response = await fetchImpl('/api/mobcode/create-solo', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: params.selectedOptions.files,
      activeFile: params.selectedOptions.activeFile,
      runnerId: params.selectedOptions.runnerId,
    }),
  })
  if (!response.ok) throw new Error('Failed to create a MobCode solo session.')
  const created = await response.json() as { id?: unknown; soloEditToken?: unknown }
  if (typeof created.id !== 'string' || typeof created.soloEditToken !== 'string') {
    throw new Error('MobCode solo session response was invalid.')
  }
  return { navigateTo: `/${encodeURIComponent(created.id)}#mobcodeSoloToken=${encodeURIComponent(created.soloEditToken)}` }
}

export default {
  ManagerComponent,
  StudentComponent,
  footerContent: null,
  launchPersistentSoloEntry: launchMobCodePersistentSoloEntry,
}
