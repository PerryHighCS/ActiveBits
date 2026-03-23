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
import { createConfiguredSyncDeckSession } from './shared/sessionLaunch.js'
import SyncDeckLaunchPresentation from './util/SyncDeckLaunchPresentation.js'

async function runSyncDeckDeepLinkPreflight(
  preflight: ActivityDeepLinkPreflightConfig,
  rawValue: string,
) {
  if (preflight.type !== 'reveal-sync-ping') {
    return { valid: false, warning: 'Unsupported validation strategy.' }
  }

  return await runSyncDeckPresentationPreflight(rawValue, { timeoutMs: preflight.timeoutMs })
}

export async function launchSyncDeckPersistentSoloEntry(
  params: ActivityPersistentSoloLaunchParams,
): Promise<ActivityPersistentSoloLaunchResult> {
  const presentationUrl =
    typeof params.selectedOptions.presentationUrl === 'string' && params.selectedOptions.presentationUrl.trim().length > 0
      ? params.selectedOptions.presentationUrl.trim()
      : null
  if (!presentationUrl) {
    throw new Error('Solo mode is unavailable because this link is missing a presentation URL.')
  }

  const { sessionId } = await createConfiguredSyncDeckSession({
    presentationUrl,
    standaloneMode: true,
  })

  return {
    sessionId,
  }
}

const syncdeckActivity: ActivityClientModule = {
  ManagerComponent: SyncDeckManager as ComponentType<unknown>,
  StudentComponent: SyncDeckStudent as ComponentType<unknown>,
  UtilComponent: SyncDeckLaunchPresentation as ComponentType<unknown>,
  PersistentLinkBuilderComponent: SyncDeckPersistentLinkBuilder as ComponentType<ActivityPersistentLinkBuilderProps>,
  footerContent: null,
  runDeepLinkPreflight: runSyncDeckDeepLinkPreflight,
  launchPersistentSoloEntry: launchSyncDeckPersistentSoloEntry,
}

export default syncdeckActivity
