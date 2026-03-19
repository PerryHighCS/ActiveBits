import type { ComponentType } from 'react'
import type {
  ActivityClientModule,
  ActivityDeepLinkPreflightConfig,
  ActivityPersistentLinkBuilderProps,
  ActivityPersistentSoloLaunchParams,
  ActivityPersistentSoloLaunchResult,
} from '../../../types/activity.js'
import SyncDeckPersistentLinkBuilder from './components/SyncDeckPersistentLinkBuilder.js'
import SyncDeckManager from './manager/SyncDeckManager.js'
import SyncDeckStudent from './student/SyncDeckStudent.js'
import { runSyncDeckPresentationPreflight } from './shared/presentationPreflight.js'

async function runSyncDeckDeepLinkPreflight(
  preflight: ActivityDeepLinkPreflightConfig,
  rawValue: string,
) {
  if (preflight.type !== 'reveal-sync-ping') {
    return { valid: false, warning: 'Unsupported validation strategy.' }
  }

  return await runSyncDeckPresentationPreflight(rawValue, { timeoutMs: preflight.timeoutMs })
}

interface SyncDeckCreateSessionResponse {
  id?: unknown
  instructorPasscode?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function launchSyncDeckPersistentSoloEntry(
  params: ActivityPersistentSoloLaunchParams,
): Promise<ActivityPersistentSoloLaunchResult> {
  const presentationUrl = readString(params.selectedOptions.presentationUrl)
  if (!presentationUrl) {
    throw new Error('Solo mode is unavailable because this link is missing a presentation URL.')
  }

  const createResponse = await fetch('/api/syncdeck/create', {
    method: 'POST',
  })
  if (!createResponse.ok) {
    throw new Error('Unable to start solo mode right now.')
  }

  const createPayload = (await createResponse.json()) as SyncDeckCreateSessionResponse
  const sessionId = readString(createPayload.id)
  const instructorPasscode = readString(createPayload.instructorPasscode)
  if (!sessionId || !instructorPasscode) {
    throw new Error('Unable to start solo mode right now.')
  }

  const configureResponse = await fetch(`/api/syncdeck/${encodeURIComponent(sessionId)}/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      presentationUrl,
      instructorPasscode,
      standaloneMode: true,
    }),
  })
  if (!configureResponse.ok) {
    throw new Error('Unable to load this presentation in solo mode right now.')
  }

  return {
    sessionId,
  }
}

const syncdeckActivity: ActivityClientModule = {
  ManagerComponent: SyncDeckManager as ComponentType<unknown>,
  StudentComponent: SyncDeckStudent as ComponentType<unknown>,
  PersistentLinkBuilderComponent: SyncDeckPersistentLinkBuilder as ComponentType<ActivityPersistentLinkBuilderProps>,
  footerContent: null,
  runDeepLinkPreflight: runSyncDeckDeepLinkPreflight,
  launchPersistentSoloEntry: launchSyncDeckPersistentSoloEntry,
}

export default syncdeckActivity
