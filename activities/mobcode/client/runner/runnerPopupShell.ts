import type { MobCodeRunnerLaunchResult, MobCodeRunnerPopup, MobCodeRunnerWindow } from './runnerTypes'

const RUNNER_POPUP_FEATURES = 'popup=yes,width=1120,height=760'

export type MobCodeRunnerPopupShellResult = MobCodeRunnerLaunchResult & { popup?: MobCodeRunnerPopup }

/** Opens during the click event so the later lazy renderer is not popup-blocked. */
export function openMobCodeRunnerPopupShell(
  browserWindow: MobCodeRunnerWindow = window,
): MobCodeRunnerPopupShellResult {
  try {
    const popup = browserWindow.open('', '_blank', RUNNER_POPUP_FEATURES)
    if (!popup) return { opened: false, reason: 'popup-blocked' }
    popup.focus()
    return { opened: true, popup }
  } catch {
    return { opened: false, reason: 'popup-blocked' }
  }
}
