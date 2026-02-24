import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'

export type ActivityRenderableComponent =
  | ComponentType<unknown>
  | LazyExoticComponent<ComponentType<unknown>>

export interface ActivityDeepLinkOptionChoice {
  value: string
  label: string
}

export interface ActivityDeepLinkOption {
  label?: string
  type?: 'select' | 'text'
  options?: ActivityDeepLinkOptionChoice[]
  validator?: 'url'
}

export interface ActivityDeepLinkPreflightConfig {
  type: 'reveal-sync-ping'
  optionKey: string
  timeoutMs?: number
}

export interface ActivityDeepLinkPreflightResult {
  valid: boolean
  warning: string | null
}

export interface ActivityPersistentLinkBuildResult {
  fullUrl: string
  hash: string
  teacherCode: string
  selectedOptions?: Record<string, unknown>
}

export interface ActivityPersistentLinkBuilderProps {
  activityId: string
  onCreated(result: ActivityPersistentLinkBuildResult): void | Promise<void>
}

export interface ActivityCreateSessionBootstrapSessionStorageEntry {
  keyPrefix: string
  responseField: string
}

export interface ActivityCreateSessionBootstrapConfig {
  sessionStorage?: ActivityCreateSessionBootstrapSessionStorageEntry[]
}

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
  deepLinkOptions?: Record<string, ActivityDeepLinkOption>
  deepLinkGenerator?: {
    endpoint: string
    mode?: 'replace-url' | 'append-query'
    expectsSelectedOptions?: boolean
    preflight?: ActivityDeepLinkPreflightConfig
  }
  createSessionBootstrap?: ActivityCreateSessionBootstrapConfig
  manageDashboard?: {
    customPersistentLinkBuilder?: boolean
  }
  manageLayout?: {
    expandShell?: boolean
  }
  isDev?: boolean
  clientEntry?: string
  serverEntry?: string
  [key: string]: unknown
}

export interface ActivityClientModule {
  ManagerComponent?: ComponentType<unknown>
  StudentComponent?: ComponentType<unknown>
  footerContent?: ReactNode | (() => ReactNode)
  PersistentLinkBuilderComponent?: ComponentType<ActivityPersistentLinkBuilderProps>
  runDeepLinkPreflight?: (
    preflight: ActivityDeepLinkPreflightConfig,
    rawValue: string,
  ) => Promise<ActivityDeepLinkPreflightResult>
}

export interface ActivityRegistryEntry extends ActivityConfig {
  ManagerComponent?: ActivityRenderableComponent | null
  StudentComponent?: ActivityRenderableComponent | null
  FooterComponent?: ActivityRenderableComponent | null
  PersistentLinkBuilderComponent?: ActivityRenderableComponent | null
}
