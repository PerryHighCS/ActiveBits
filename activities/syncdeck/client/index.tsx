import type { ComponentType } from 'react'
import type { ActivityClientModule, ActivityDeepLinkPreflightConfig } from '../../../types/activity.js'
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

const syncdeckActivity: ActivityClientModule = {
  ManagerComponent: SyncDeckManager as ComponentType<unknown>,
  StudentComponent: SyncDeckStudent as ComponentType<unknown>,
  footerContent: null,
  runDeepLinkPreflight: runSyncDeckDeepLinkPreflight,
}

export default syncdeckActivity
