import { randomBytes } from 'node:crypto'

export function generateParticipantId(): string {
  return randomBytes(8).toString('hex')
}
