import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type {
  ActivityWaitingRoomConfig,
  WaitingRoomFieldComponentProps,
} from './waitingRoom.js'

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
  historyState?: string[]
}

export interface ActivityUtility {
  id: string
  label: string
  action: 'copy-url' | 'go-to-url'
  path: string
  description?: string
  surfaces?: Array<'manage' | 'home'>
  standaloneSessionId?: string
}

export interface ActivityStandaloneEntryConfig {
  enabled: boolean
  supportsDirectPath?: boolean
  supportsPermalink?: boolean
  showOnHome?: boolean
  title?: string
  description?: string
}

export interface ActivityEmbeddedRuntimeConfig {
  instructorGated?: 'runtime' | 'waiting-room'
}

export type ActivityReportScope = 'activity-session' | 'student-cross-activity' | 'session-summary'

export interface ActivityReportStudentRef {
  studentId: string
  displayName?: string | null
}

export interface ActivityReportSummaryMetric {
  id: string
  label: string
  value: string | number
  description?: string
}

export interface ActivityReportSummaryCard {
  id: string
  title: string
  description?: string
  metrics?: ActivityReportSummaryMetric[]
}

export interface ActivityStructuredReportSection {
  activityId: string
  childSessionId: string
  instanceKey: string
  title: string
  generatedAt: number
  supportsScopes: ActivityReportScope[]
  students?: ActivityReportStudentRef[]
  summaryCards?: ActivityReportSummaryCard[]
  payload: Record<string, unknown>
}

export interface SyncDeckSessionReportManifestActivity {
  activityId: string
  activityName: string
  childSessionId: string
  instanceKey: string
  startedAt: number
  report: ActivityStructuredReportSection
}

export interface SyncDeckSessionReportManifest {
  parentSessionId: string
  generatedAt: number
  activities: SyncDeckSessionReportManifestActivity[]
  students: ActivityReportStudentRef[]
}

export interface ActivityReportSectionProps {
  scope: ActivityReportScope
  manifest: SyncDeckSessionReportManifest
  activity: SyncDeckSessionReportManifestActivity
  student?: ActivityReportStudentRef | null
}

export interface ActivityConfig {
  id: string
  name: string
  title?: string
  description: string
  color: string
  standaloneEntry: ActivityStandaloneEntryConfig
  utilities?: ActivityUtility[]
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
  embeddedRuntime?: ActivityEmbeddedRuntimeConfig
  reportEndpoint?: string
  waitingRoom?: ActivityWaitingRoomConfig
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
  ReportSectionComponent?: ComponentType<ActivityReportSectionProps>
  runDeepLinkPreflight?: (
    preflight: ActivityDeepLinkPreflightConfig,
    rawValue: string,
  ) => Promise<ActivityDeepLinkPreflightResult>
  waitingRoomFields?: Record<string, ComponentType<WaitingRoomFieldComponentProps>>
}

export interface ActivityRegistryEntry extends ActivityConfig {
  ManagerComponent?: ActivityRenderableComponent | null
  StudentComponent?: ActivityRenderableComponent | null
  FooterComponent?: ActivityRenderableComponent | null
  PersistentLinkBuilderComponent?: ActivityRenderableComponent | null
}
