export interface PersistentSessionPolicyRejectionPayload {
  error: string
  code: 'entry-policy-rejected'
  entryPolicy: 'solo-only'
}

export function buildSoloOnlyPolicyRejection(): PersistentSessionPolicyRejectionPayload {
  return {
    error: 'This permanent link is configured for solo use only.',
    code: 'entry-policy-rejected',
    entryPolicy: 'solo-only',
  }
}
