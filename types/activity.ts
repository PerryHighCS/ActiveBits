import type { ComponentType, ReactNode } from 'react'

export interface ActivityConfig {
  id: string
  title?: string
  description?: string
  isDev?: boolean
  clientEntry?: string
  serverEntry?: string
}

export interface ActivityClientModule {
  ManagerComponent?: ComponentType<unknown>
  StudentComponent?: ComponentType<unknown>
  footerContent?: ReactNode | (() => ReactNode)
}

export interface ActivityRegistryEntry extends ActivityConfig {
  ManagerComponent?: ComponentType<unknown> | null
  StudentComponent?: ComponentType<unknown> | null
  FooterComponent?: ComponentType<unknown> | null
}
