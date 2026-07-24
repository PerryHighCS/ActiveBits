import type http from 'node:http'
import type { TestContext } from 'node:test'

function isPortBindingPermissionError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && ((error as { code?: unknown }).code === 'EACCES' || (error as { code?: unknown }).code === 'EPERM')
}

/**
 * Starts a local test server, skipping only when the environment blocks port binding.
 * All other listen failures remain test failures.
 */
export async function listenForTest(
  t: TestContext,
  server: http.Server,
  host?: string,
): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('error', onError)
        reject(error)
      }
      server.once('error', onError)
      server.listen(0, host, () => {
        server.off('error', onError)
        resolve()
      })
    })
    return true
  } catch (error) {
    if (!isPortBindingPermissionError(error)) {
      throw error
    }

    const message = `[SKIPPED] Local port binding is not permitted (${(error as { code: string }).code}).`
    console.log(message)
    t.skip(message)
    return false
  }
}
