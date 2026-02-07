import type { SessionStore } from './session'

declare global {
  namespace Express {
    interface Locals {
      sessions?: SessionStore
    }
  }
}

export {}
