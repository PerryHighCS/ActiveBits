import type { ActivityRegistryEntry } from '../../../../types/activity.js'
import { isValidHttpUrl } from './urlValidationUtils'
import {
  buildCreateSessionBootstrapHistoryState,
  buildQueryString,
  normalizeSelectedOptions,
  parseDeepLinkOptions,
} from './manageDashboardUtils'

export interface ActivitySessionCreateResponse {
  id: string
  [key: string]: unknown
}

export interface LaunchOptionsResult {
  selectedOptions: Record<string, string>
  errors: string[]
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function isStandaloneActivityLauncherAutoStart(search: string): boolean {
  return new URLSearchParams(search).get('start') === '1'
}

export function getStandaloneActivityLauncherRequestedOptions(search: string): Record<string, string> {
  const params = new URLSearchParams(search)
  const requestedOptions: Record<string, string> = {}

  for (const [key, value] of params.entries()) {
    if (key === 'start') {
      continue
    }

    requestedOptions[key] = value
  }

  return requestedOptions
}

export function resolveStandaloneActivityLauncherOptions(
  rawDeepLinkOptions: unknown,
  search: string,
): LaunchOptionsResult {
  const requestedOptions = getStandaloneActivityLauncherRequestedOptions(search)
  const selectedOptions = normalizeSelectedOptions(rawDeepLinkOptions, requestedOptions)
  const parsedOptions = parseDeepLinkOptions(rawDeepLinkOptions)
  const errors: string[] = []

  for (const [key, value] of Object.entries(selectedOptions)) {
    const option = parsedOptions[key]
    if (option?.validator === 'url' && !isValidHttpUrl(value)) {
      errors.push(`${option.label || key} must be a valid http(s) URL`)
    }
  }

  return {
    selectedOptions,
    errors,
  }
}

export function buildStandaloneActivityLauncherManagePath(
  activityId: string,
  sessionId: string,
  selectedOptions: Record<string, unknown>,
): string {
  return `/manage/${activityId}/${sessionId}${buildQueryString(selectedOptions)}`
}

export function buildStandaloneActivityLauncherState(
  activity: Pick<ActivityRegistryEntry, 'createSessionBootstrap'>,
  payload: Record<string, unknown>,
): { createSessionPayload: Record<string, unknown> } | null {
  const createSessionPayload = buildCreateSessionBootstrapHistoryState(activity.createSessionBootstrap, payload)
  return createSessionPayload ? { createSessionPayload } : null
}

export async function createStandaloneActivitySession(
  activityId: string,
  fetchImpl: FetchLike = fetch,
): Promise<ActivitySessionCreateResponse> {
  const response = await fetchImpl(`/api/${activityId}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Failed to create session')
  }

  const payload = (await response.json()) as Record<string, unknown>
  if (typeof payload.id !== 'string' || payload.id.length === 0) {
    throw new Error('Failed to create session')
  }

  return {
    ...payload,
    id: payload.id,
  }
}
