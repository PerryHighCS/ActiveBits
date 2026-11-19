import { expect, request as playwrightRequest, type APIRequestContext, test } from '@playwright/test'

/** A student registered through the API, with the participant cookie the server set. */
export interface ApiStudent {
  participantId: string
  /** `name=value` of the httpOnly participant capability cookie. */
  cookie: string
}

/**
 * Registers a student through the API. Students are identified only by the httpOnly
 * participant cookie, and a request that already carries one reconnects that student,
 * so each registration uses its own throwaway request context (a clean cookie jar).
 * The cookie is read from `Set-Cookie` and sent explicitly on that student's later
 * requests (`postAsStudent`), never stored in the shared `request` jar.
 */
export async function registerStudentViaApi(_request: APIRequestContext, sessionId: string, name: string): Promise<ApiStudent> {
  const baseURL = test.info().project.use.baseURL
  const context = await playwrightRequest.newContext(baseURL ? { baseURL } : {})
  try {
    const response = await context.post(`/api/commissioned-ideas/${sessionId}/register-participant`, { data: { name } })
    expect(response.ok()).toBe(true)
    const { participantId } = await response.json() as { participantId: string }
    const setCookie = response.headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => header.value.split(';')[0] ?? '')
      .find((pair) => pair.startsWith('activebits_cap_participant_'))
    expect(setCookie, 'register-participant sets the participant cookie').toBeTruthy()
    return { participantId, cookie: setCookie ?? '' }
  } finally {
    await context.dispose()
  }
}

/** A participant-authenticated POST as `who`. */
export async function postAsStudent(
  request: APIRequestContext,
  sessionId: string,
  who: ApiStudent,
  path: string,
  body: Record<string, unknown> = {},
) {
  // Like the app: the action names the participant this client is bound to. Set last, so
  // a body field cannot change the helper's identity (a test that needs a mismatch should
  // build that request explicitly).
  return await request.post(`/api/commissioned-ideas/${sessionId}/${path}`, {
    data: { ...body, expectedParticipantId: who.participantId },
    headers: { Cookie: who.cookie },
  })
}

/** Registers a student and has them create a team; returns the team id. */
export async function createTeamViaApi(request: APIRequestContext, sessionId: string, name: string): Promise<string> {
  const who = await registerStudentViaApi(request, sessionId, name)
  const response = await postAsStudent(request, sessionId, who, 'create-team')
  expect(response.ok()).toBe(true)
  return (await response.json() as { teamId: string }).teamId
}

/**
 * Specs that drive the student UI in a browser need the participant cookie. The
 * Playwright server runs with NODE_ENV=production, so the cookie is Secure, and WebKit
 * drops Secure cookies on the plain-HTTP harness origin. Production Safari runs on
 * HTTPS. Same convention as the manager-cookie and Resonance auth specs.
 */
export function skipStudentBrowserFlowsOnWebKit(): void {
  test.skip(test.info().project.name !== 'chromium', 'WebKit drops the Secure participant cookie on the harness HTTP origin; production Safari runs on HTTPS.')
}
