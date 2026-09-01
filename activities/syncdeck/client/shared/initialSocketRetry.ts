const WS_CONNECTING_READY_STATE = 0
const WS_OPEN_READY_STATE = 1

/**
 * Decide whether the bounded "initial connect" retry should open a fresh socket.
 *
 * The retry exists to recover a socket that never left the gate (for example a
 * setup that was cancelled by a React Strict Mode remount before it opened).
 * A socket that is still `CONNECTING` has a live handshake, and reconnecting
 * would close it and start over, so the retry must leave it alone until it
 * opens or fails on its own. An already-`OPEN` socket needs no retry either.
 *
 * @param readyState - `WebSocket.readyState` of the current socket, or
 *   `null`/`undefined` when there is no socket yet.
 */
export function shouldRetryInitialSocket(readyState: number | null | undefined): boolean {
  return readyState !== WS_CONNECTING_READY_STATE && readyState !== WS_OPEN_READY_STATE
}
