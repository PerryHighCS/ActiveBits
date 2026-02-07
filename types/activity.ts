import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'

export type ActivityRenderableComponent =
  | ComponentType<unknown>
  | LazyExoticComponent<ComponentType<unknown>>

export interface ActivityConfig {
  id: string
  name: string
  title?: string
  description: string
  color: string
  soloMode: boolean
  soloModeMeta?: {
    title?: string
    description?: string
    buttonText?: string
  }
  deepLinkOptions?: Record<string, unknown>
  isDev?: boolean
  clientEntry?: string
  serverEntry?: string
  [key: string]: unknown
}

export interface ActivityClientModule {
  ManagerComponent?: ComponentType<unknown>
  StudentComponent?: ComponentType<unknown>
  footerContent?: ReactNode | (() => ReactNode)
}

export interface ActivityRegistryEntry extends ActivityConfig {
  ManagerComponent?: ActivityRenderableComponent | null
  StudentComponent?: ActivityRenderableComponent | null
  FooterComponent?: ActivityRenderableComponent | null
}
