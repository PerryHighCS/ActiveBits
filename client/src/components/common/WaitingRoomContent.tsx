import type { ChangeEvent, ComponentType, FormEvent } from 'react'
import type {
  WaitingRoomFieldConfig,
  WaitingRoomFieldComponentProps,
  WaitingRoomSerializableValue,
} from '../../../../types/waitingRoom.js'
import Button from '../ui/Button'
import { getCustomFieldStatus } from './waitingRoomFieldUtils'
import type { PersistentSessionEntryOutcome } from './persistentSessionEntryPolicyUtils'
import { getWaitingRoomViewModel } from './waitingRoomViewUtils'
import type { PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'
import type { WaitingRoomFieldValueMap } from './waitingRoomFormUtils'
import { getWaiterMessage } from './waitingRoomUtils'

interface WaitingRoomContentProps {
  activityDisplayName: string
  waiterCount: number
  error: string | null
  isSubmitting: boolean
  waitingRoomFields: readonly WaitingRoomFieldConfig[]
  waitingRoomValues: WaitingRoomFieldValueMap
  touchedFields: Record<string, boolean>
  waitingRoomErrors: Record<string, string>
  customFieldComponents: Record<string, ComponentType<WaitingRoomFieldComponentProps>>
  customFieldLoadError: string | null
  entryOutcome: PersistentSessionEntryOutcome
  entryPolicy?: PersistentSessionEntryPolicy
  allowTeacherSection: boolean
  showShareUrl: boolean
  hasTeacherCookie: boolean
  teacherCode: string
  shareUrl: string
  onTeacherCodeChange: (value: string) => void
  onTeacherCodeSubmit: (event: FormEvent<HTMLFormElement>) => void
  onPrimaryAction: () => void
  onFieldChange: (fieldId: string, value: WaitingRoomSerializableValue) => void
  onFieldBlur: (fieldId: string) => void
}

function getFieldLabel(field: WaitingRoomFieldConfig): string {
  return field.label?.trim() || field.id
}

function toFieldStringValue(value: WaitingRoomSerializableValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export default function WaitingRoomContent({
  activityDisplayName,
  waiterCount,
  error,
  isSubmitting,
  waitingRoomFields,
  waitingRoomValues,
  touchedFields,
  waitingRoomErrors,
  customFieldComponents,
  customFieldLoadError,
  entryOutcome,
  entryPolicy,
  allowTeacherSection,
  showShareUrl,
  hasTeacherCookie,
  teacherCode,
  shareUrl,
  onTeacherCodeChange,
  onTeacherCodeSubmit,
  onPrimaryAction,
  onFieldChange,
  onFieldBlur,
}: WaitingRoomContentProps) {
  const viewModel = getWaitingRoomViewModel(entryOutcome)
  const isSoloOnlyMode = entryPolicy === 'solo-only'

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full border-2 border-gray-200">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">{activityDisplayName}</h1>

        <div className="text-center mb-6">
          <p className="text-lg text-gray-600 mb-2">{viewModel.statusTitle}</p>
          {viewModel.showWaiterCount ? (
            <p className="text-2xl font-bold text-blue-600">{getWaiterMessage(waiterCount)}</p>
          ) : (
            <p className="text-sm text-gray-600">{viewModel.statusDetail}</p>
          )}
        </div>

        {waitingRoomFields.length > 0 && (
          <section aria-labelledby="waiting-room-fields-heading" className="border-t-2 border-gray-200 pt-6 mt-6">
            <h2 id="waiting-room-fields-heading" className="text-center text-gray-800 mb-2 font-semibold">{viewModel.fieldHeading}</h2>
            <p className="text-sm text-gray-600 text-center mb-4">{viewModel.fieldDescription}</p>
            <div className="space-y-4">
              {waitingRoomFields.map((field) => {
                const fieldId = `waiting-room-field-${field.id}`
                const helpId = field.helpText ? `${fieldId}-help` : undefined
                const errorId = waitingRoomErrors[field.id] ? `${fieldId}-error` : undefined
                const describedBy = [helpId, touchedFields[field.id] ? errorId : undefined].filter(Boolean).join(' ') || undefined
                const fieldError = touchedFields[field.id] ? waitingRoomErrors[field.id] : undefined
                const CustomFieldComponent = field.type === 'custom' ? (customFieldComponents[field.component] ?? null) : null
                const customFieldStatus = getCustomFieldStatus(field, CustomFieldComponent, customFieldLoadError)
                const fieldLabel = (
                  <>
                    {getFieldLabel(field)}
                    {field.required ? ' *' : ''}
                  </>
                )

                return (
                  <div key={field.id} className="flex flex-col gap-2">
                    {field.type === 'custom' ? (
                      <div id={`${fieldId}-label`} className="text-sm font-semibold text-gray-700">
                        {fieldLabel}
                      </div>
                    ) : (
                      <label htmlFor={fieldId} className="text-sm font-semibold text-gray-700">
                        {fieldLabel}
                      </label>
                    )}

                    {field.type === 'text' && (
                      <input
                        id={fieldId}
                        type="text"
                        value={toFieldStringValue(waitingRoomValues[field.id])}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => onFieldChange(field.id, event.target.value)}
                        onBlur={() => onFieldBlur(field.id)}
                        placeholder={field.placeholder}
                        className="border-2 border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
                        aria-invalid={fieldError ? 'true' : undefined}
                        aria-describedby={describedBy}
                        aria-required={field.required || undefined}
                        required={field.required}
                      />
                    )}

                    {field.type === 'select' && (
                      <select
                        id={fieldId}
                        value={toFieldStringValue(waitingRoomValues[field.id])}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => onFieldChange(field.id, event.target.value)}
                        onBlur={() => onFieldBlur(field.id)}
                        className="border-2 border-gray-300 rounded px-4 py-2 bg-white focus:outline-none focus:border-blue-500"
                        aria-invalid={fieldError ? 'true' : undefined}
                        aria-describedby={describedBy}
                        aria-required={field.required || undefined}
                        required={field.required}
                      >
                        <option value="">Select an option</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    )}

                    {field.type === 'custom' && (
                      <div
                        id={fieldId}
                        role="group"
                        aria-labelledby={`${fieldId}-label`}
                        aria-describedby={describedBy}
                        aria-invalid={fieldError ? 'true' : undefined}
                        className="flex flex-col gap-2"
                      >
                        {CustomFieldComponent ? (
                          <CustomFieldComponent
                            field={field}
                            value={waitingRoomValues[field.id] ?? null}
                            onChange={(value) => {
                              onFieldChange(field.id, value)
                              onFieldBlur(field.id)
                            }}
                            disabled={isSubmitting}
                            error={fieldError}
                          />
                        ) : (
                          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            {customFieldStatus}
                          </div>
                        )}
                      </div>
                    )}

                    {field.helpText && (
                      <p id={helpId} className="text-xs text-gray-500">{field.helpText}</p>
                    )}
                    {fieldError && (
                      <p id={errorId} className="text-sm text-red-600">{fieldError}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {viewModel.primaryActionLabel && (
          <div className="border-t-2 border-gray-200 pt-6 mt-6 flex flex-col items-center gap-3">
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <Button type="button" onClick={onPrimaryAction}>
              {viewModel.primaryActionLabel}
            </Button>
          </div>
        )}

        {viewModel.showTeacherSection && allowTeacherSection && (
          <div className="border-t-2 border-gray-200 pt-6 mt-6">
            <p className="text-center text-gray-700 mb-4 font-semibold">
              {entryOutcome === 'continue-solo' ? 'Want to start a live session instead?' : 'Are you the teacher?'}
            </p>

            <form onSubmit={onTeacherCodeSubmit} className="flex flex-col items-center gap-4">
              <label htmlFor="waiting-room-teacher-code" className="sr-only">Teacher code</label>
              <input
                id="waiting-room-teacher-code"
                type="password"
                placeholder="Enter teacher code"
                value={teacherCode}
                onChange={(event) => onTeacherCodeChange(event.target.value)}
                className="border-2 border-gray-300 rounded px-4 py-2 w-full max-w-xs text-center focus:outline-none focus:border-blue-500"
                disabled={isSubmitting}
                autoComplete="off"
              />

              {error && !viewModel.primaryActionLabel && <p className="text-red-600 text-sm">{error}</p>}

              <Button
                type="submit"
                disabled={isSubmitting || !teacherCode.trim() || isSoloOnlyMode}
              >
                {isSubmitting ? 'Verifying...' : entryOutcome === 'join-live' ? 'Open Manage Dashboard' : 'Start Activity'}
              </Button>
            </form>

            {isSoloOnlyMode && (
              <p className="text-xs text-gray-500 text-center mt-4">
                This link is configured for solo use only, so live teacher startup is unavailable here.
              </p>
            )}

            {hasTeacherCookie && (
              <p className="text-xs text-gray-500 text-center mt-4">
                Tip: Your browser remembers your teacher code for this link
              </p>
            )}
          </div>
        )}
      </div>

      {showShareUrl && (
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Share this URL with your students:</p>
          <code className="bg-gray-100 px-3 py-1 rounded mt-1 inline-block text-xs">{shareUrl}</code>
        </div>
      )}
    </div>
  )
}
