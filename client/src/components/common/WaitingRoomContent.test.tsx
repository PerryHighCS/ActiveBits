import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import WaitingRoomContent from './WaitingRoomContent'
import type { WaitingRoomFieldConfig } from '../../../../types/waitingRoom.js'

const sampleFields: readonly WaitingRoomFieldConfig[] = [
  {
    id: 'displayName',
    type: 'text',
    label: 'Display name',
    required: true,
    helpText: 'This name will appear to your teacher.',
  },
  {
    id: 'team',
    type: 'select',
    label: 'Team',
    required: true,
    options: [
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ],
  },
]

void test('WaitingRoomContent renders required-field accessibility attributes and linked errors', () => {
  const html = renderToStaticMarkup(
    <WaitingRoomContent
      activityDisplayName="Java String Practice"
      waiterCount={3}
      error={null}
      isSubmitting={false}
      waitingRoomFields={sampleFields}
      waitingRoomValues={{ displayName: '', team: '' }}
      touchedFields={{ displayName: true }}
      waitingRoomErrors={{ displayName: 'Display name is required.' }}
      customFieldComponents={{}}
      customFieldLoadError={null}
      entryOutcome="join-live"
      allowTeacherSection
      showShareUrl={false}
      hasTeacherCookie={false}
      teacherCode=""
      shareUrl=""
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

  assert.match(html, /id="waiting-room-field-displayName"/)
  assert.match(html, /required=""/)
  assert.match(html, /aria-required="true"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /aria-describedby="waiting-room-field-displayName-help waiting-room-field-displayName-error"/)
  assert.match(html, /Display name is required\./)
})

void test('WaitingRoomContent disables teacher startup in solo-only mode', () => {
  const html = renderToStaticMarkup(
    <WaitingRoomContent
      activityDisplayName="Java String Practice"
      waiterCount={0}
      error={null}
      isSubmitting={false}
      waitingRoomFields={[]}
      waitingRoomValues={{}}
      touchedFields={{}}
      waitingRoomErrors={{}}
      customFieldComponents={{}}
      customFieldLoadError={null}
      entryOutcome="continue-solo"
      entryPolicy="solo-only"
      allowTeacherSection
      showShareUrl={false}
      hasTeacherCookie
      teacherCode="secret-code"
      shareUrl=""
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

  assert.match(html, /This link is configured for solo use only/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>Start Activity<\/button>/)
})
