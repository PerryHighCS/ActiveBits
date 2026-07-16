import ManagerComponent from './manager/MobCodeManager'
import StudentComponent from './student/MobCodeStudent'
import type { ActivityPersistentSoloLaunchParams, ActivityPersistentSoloLaunchResult } from '../../../types/activity.js'

export async function launchMobCodePersistentSoloEntry(
  params: ActivityPersistentSoloLaunchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityPersistentSoloLaunchResult> {
  const response = await fetchImpl('/api/mobcode/create-solo', {
    method: 'POST',
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
  return { navigateTo: `/${encodeURIComponent(created.id)}?mobcodeSoloToken=${encodeURIComponent(created.soloEditToken)}` }
}

export default {
  ManagerComponent,
  StudentComponent,
  footerContent: null,
  launchPersistentSoloEntry: launchMobCodePersistentSoloEntry,
}
