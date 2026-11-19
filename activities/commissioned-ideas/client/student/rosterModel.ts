/**
 * Team controls (Join, Switch, Leave, Create) reflect the roster as of the rendered
 * snapshot. After a committed team change they stay disabled until a snapshot at or
 * after that write's revision arrives; otherwise a stale "no team" view could offer
 * Create again between the response and the snapshot.
 */
export function teamControlsLocked(busy: boolean, awaitedRevision: number | null, snapshotRevision: number): boolean {
  return busy || (awaitedRevision !== null && snapshotRevision < awaitedRevision)
}
