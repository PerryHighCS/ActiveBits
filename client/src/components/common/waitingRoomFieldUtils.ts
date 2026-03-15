import type { ComponentType } from 'react'
import type { WaitingRoomFieldComponentProps, WaitingRoomFieldConfig } from '../../../../types/waitingRoom.js'

function getFieldLabel(field: WaitingRoomFieldConfig): string {
  return field.label?.trim() || field.id
}

export function getCustomFieldStatus(
  field: WaitingRoomFieldConfig,
  CustomFieldComponent: ComponentType<WaitingRoomFieldComponentProps> | null,
  customFieldLoadError: string | null,
): string {
  if (field.type !== 'custom') {
    return ''
  }

  if (CustomFieldComponent) {
    return ''
  }

  if (customFieldLoadError) {
    return `${customFieldLoadError} ${getFieldLabel(field)} cannot be rendered.`
  }

  return `Loading custom field for ${getFieldLabel(field)}...`
}
