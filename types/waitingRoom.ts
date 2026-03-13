export const PERSISTENT_SESSION_ENTRY_POLICIES = [
  'instructor-required',
  'solo-allowed',
  'solo-only',
] as const

export type PersistentSessionEntryPolicy = (typeof PERSISTENT_SESSION_ENTRY_POLICIES)[number]

export const DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY: PersistentSessionEntryPolicy = 'instructor-required'

export type WaitingRoomSerializableValue =
  | null
  | boolean
  | number
  | string
  | WaitingRoomSerializableValue[]
  | { [key: string]: WaitingRoomSerializableValue }

export interface WaitingRoomFieldOption {
  value: string
  label: string
}

export interface WaitingRoomFieldBaseConfig {
  id: string
  label?: string
  helpText?: string
  required?: boolean
}

export interface WaitingRoomTextFieldConfig extends WaitingRoomFieldBaseConfig {
  type: 'text'
  placeholder?: string
  defaultValue?: string
}

export interface WaitingRoomSelectFieldConfig extends WaitingRoomFieldBaseConfig {
  type: 'select'
  options: WaitingRoomFieldOption[]
  defaultValue?: string
}

export interface WaitingRoomCustomFieldConfig extends WaitingRoomFieldBaseConfig {
  type: 'custom'
  component: string
  props?: Record<string, WaitingRoomSerializableValue>
  defaultValue?: WaitingRoomSerializableValue
}

export type WaitingRoomFieldConfig =
  | WaitingRoomTextFieldConfig
  | WaitingRoomSelectFieldConfig
  | WaitingRoomCustomFieldConfig

export interface ActivityWaitingRoomConfig {
  fields: WaitingRoomFieldConfig[]
}

export interface WaitingRoomFieldComponentProps<T = WaitingRoomSerializableValue> {
  field: WaitingRoomFieldConfig
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  error?: string
}

export function isPersistentSessionEntryPolicy(value: unknown): value is PersistentSessionEntryPolicy {
  return typeof value === 'string' && PERSISTENT_SESSION_ENTRY_POLICIES.includes(value as PersistentSessionEntryPolicy)
}

export function resolvePersistentSessionEntryPolicy(value: unknown): PersistentSessionEntryPolicy {
  return isPersistentSessionEntryPolicy(value) ? value : DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY
}
