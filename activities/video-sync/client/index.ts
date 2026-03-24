import type { ComponentType } from 'react'
import type {
  ActivityClientModule,
  ActivityPersistentSoloLaunchParams,
  ActivityPersistentSoloLaunchResult,
} from '../../../types/activity.js'
import VideoSyncManager from './manager/VideoSyncManager.js'
import VideoSyncStudent from './student/VideoSyncStudent.js'

export async function launchVideoSyncPersistentSoloEntry(
  params: ActivityPersistentSoloLaunchParams,
): Promise<ActivityPersistentSoloLaunchResult> {
  const sourceUrl = typeof params.selectedOptions?.sourceUrl === 'string'
    ? params.selectedOptions.sourceUrl.trim()
    : null
  if (sourceUrl == null || sourceUrl.length === 0) {
    throw new Error('Video Sync solo entry requires a configured YouTube URL.')
  }

  const createResponse = await fetch('/api/video-sync/create', {
    method: 'POST',
  })
  if (!createResponse.ok) {
    throw new Error('Failed to create Video Sync solo session.')
  }

  const created = (await createResponse.json()) as {
    id?: unknown
    instructorPasscode?: unknown
  }
  if (typeof created.id !== 'string' || created.id.length === 0 || typeof created.instructorPasscode !== 'string' || created.instructorPasscode.length === 0) {
    throw new Error('Video Sync solo session response was invalid.')
  }

  const configureResponse = await fetch(`/api/video-sync/${encodeURIComponent(created.id)}/session`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instructorPasscode: created.instructorPasscode,
      sourceUrl,
      standaloneMode: true,
    }),
  })
  if (!configureResponse.ok) {
    throw new Error('Failed to configure Video Sync solo session.')
  }

  return {
    sessionId: created.id,
  }
}

const videoSyncActivity: ActivityClientModule = {
  ManagerComponent: VideoSyncManager as ComponentType<unknown>,
  StudentComponent: VideoSyncStudent as ComponentType<unknown>,
  footerContent: null,
  launchPersistentSoloEntry: launchVideoSyncPersistentSoloEntry,
}

export default videoSyncActivity
