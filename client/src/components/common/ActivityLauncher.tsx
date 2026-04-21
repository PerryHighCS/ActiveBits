import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ActivityRegistryEntry } from '../../../../types/activity.js'
import { activities } from '@src/activities'
import Button from '@src/components/ui/Button'
import {
  buildStandaloneActivityLauncherManagePath,
  buildStandaloneActivityLauncherState,
  createStandaloneActivitySession,
  isStandaloneActivityLauncherAutoStart,
  resolveStandaloneActivityLauncherOptions,
} from './activityLauncherUtils'
import {
  persistCreateSessionBootstrapToSessionStorage,
  storeCreateSessionBootstrapPayload,
} from './manageDashboardUtils'

interface ActivityLauncherParams {
  [key: string]: string | undefined
  activityId?: string
}

interface ActivityLauncherProps {
  activityRegistry?: ActivityRegistryEntry[]
}

type LaunchStatus = 'idle' | 'starting' | 'failed' | 'started'

interface ResolvedLaunchOptions {
  errors: string[]
  selectedOptions: Record<string, string>
}

function getActivityTitle(activity: ActivityRegistryEntry): string {
  return activity.title || activity.name
}

function ActivityLauncherBody({
  activity,
  autoStart,
  launchOptions,
}: {
  activity: ActivityRegistryEntry
  autoStart: boolean
  launchOptions: ResolvedLaunchOptions
}) {
  const navigate = useNavigate()
  const autoStartAttemptedRef = useRef(false)
  const [status, setStatus] = useState<LaunchStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const startActivity = useCallback(async () => {
    if (status === 'starting') {
      return
    }

    setStatus('starting')
    setError(null)

    try {
      const payload = await createStandaloneActivitySession(activity.id)
      const navigationState = buildStandaloneActivityLauncherState(activity, payload)

      persistCreateSessionBootstrapToSessionStorage(activity.createSessionBootstrap, payload.id, payload)
      if (navigationState != null) {
        storeCreateSessionBootstrapPayload(activity.id, payload.id, navigationState.createSessionPayload)
      }

      setStatus('started')
      void navigate(
        buildStandaloneActivityLauncherManagePath(activity.id, payload.id, launchOptions.selectedOptions),
        {
          ...(navigationState ? { state: navigationState } : {}),
        },
      )
    } catch (launchError) {
      console.error(launchError)
      setStatus('failed')
      setError('Could not start this activity. Please try again.')
    }
  }, [activity, launchOptions.selectedOptions, navigate, status])

  useEffect(() => {
    if (!autoStart || autoStartAttemptedRef.current || launchOptions.errors.length > 0) {
      return
    }

    autoStartAttemptedRef.current = true
    queueMicrotask(() => {
      void startActivity()
    })
  }, [autoStart, launchOptions.errors.length, startActivity])

  const activityTitle = getActivityTitle(activity)
  const isStarting = status === 'starting'
  const canStart = launchOptions.errors.length === 0 && !isStarting

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-gray-600">Standalone session</p>
        <h1 className="mt-1 text-3xl font-bold text-gray-900">Start {activityTitle}</h1>
      </div>

      <p className="text-gray-700">
        This opens a new standalone activity session in this tab. Students join using the activity&apos;s normal join code, QR code, or link.
      </p>

      {launchOptions.errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3" role="alert">
          <p className="font-semibold text-red-800">This launch link needs attention.</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
            {launchOptions.errors.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3" role="alert">
          <p className="font-semibold text-red-800">{error}</p>
        </div>
      )}

      {autoStart && isStarting && (
        <p className="text-gray-700" aria-live="polite">Starting session...</p>
      )}

      {(!autoStart || status === 'failed' || launchOptions.errors.length > 0) && (
        <Button
          type="button"
          onClick={() => {
            void startActivity()
          }}
          disabled={!canStart}
          className="w-fit bg-green-600 text-white hover:bg-green-700"
          aria-disabled={!canStart}
        >
          {isStarting ? 'Starting...' : 'Start session'}
        </Button>
      )}
    </main>
  )
}

export default function ActivityLauncher({
  activityRegistry = activities,
}: ActivityLauncherProps = {}) {
  const { activityId } = useParams<ActivityLauncherParams>()
  const location = useLocation()

  const activity = useMemo(
    () => activityRegistry.find((entry) => entry.id === activityId) ?? null,
    [activityId, activityRegistry],
  )
  const autoStart = isStandaloneActivityLauncherAutoStart(location.search)
  const launchOptions = useMemo(
    () => resolveStandaloneActivityLauncherOptions(activity?.deepLinkOptions, location.search),
    [activity?.deepLinkOptions, location.search],
  )

  if (activityId == null || activityId.length === 0 || activity == null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900">Activity not found</h1>
        <p className="text-gray-700">Check the launch link and try again.</p>
      </main>
    )
  }

  return (
    <ActivityLauncherBody
      key={`${activity.id}:${location.search}`}
      activity={activity}
      autoStart={autoStart}
      launchOptions={launchOptions}
    />
  )
}
