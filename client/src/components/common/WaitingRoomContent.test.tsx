import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import WaitingRoomContent from './WaitingRoomContent'
import type { WaitingRoomFieldConfig } from '../../../../types/waitingRoom.js'

void React

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

void test('WaitingRoomContent hides teacher and share sections in solo-only mode', () => {
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
      showShareUrl
      hasTeacherCookie
      teacherCode="secret-code"
      shareUrl="https://bits.example/activity/java-string-practice/hash?entryPolicy=solo-only&urlHash=abcd"
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

  assert.doesNotMatch(html, /Are you the teacher\?/)
  assert.doesNotMatch(html, /Want to start a live session instead\?/)
  assert.doesNotMatch(html, /Enter teacher code/)
  assert.doesNotMatch(html, /Share this URL with your students:/)
})

void test('WaitingRoomContent avoids duplicate instructional copy for live preflight fields', () => {
  const html = renderToStaticMarkup(
    <WaitingRoomContent
      activityDisplayName="Java String Practice"
      waiterCount={0}
      error={null}
      isSubmitting={false}
      waitingRoomFields={sampleFields}
      waitingRoomValues={{ displayName: '', team: '' }}
      touchedFields={{}}
      waitingRoomErrors={{}}
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

  assert.doesNotMatch(html, /Ready when you are/)
  assert.doesNotMatch(html, /Join the live session when you are ready\./)
  assert.doesNotMatch(html, /Before you join/)
  assert.doesNotMatch(html, /Complete these details before entering the live session\./)
})

void test('WaitingRoomContent labels the solo-to-live teacher prompt explicitly', () => {
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
      entryPolicy="solo-allowed"
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

  assert.match(html, /Teachers: Want to start a live session instead\?/)
  assert.match(html, /Continue in Solo Mode/)
})

void test('WaitingRoomContent surfaces an explicit teacher-entry path for fresh live-session devices', () => {
  const html = renderToStaticMarkup(
    <WaitingRoomContent
      activityDisplayName="SyncDeck"
      waiterCount={0}
      error={null}
      isSubmitting={false}
      waitingRoomFields={sampleFields}
      waitingRoomValues={{ displayName: '', team: '' }}
      touchedFields={{}}
      waitingRoomErrors={{}}
      customFieldComponents={{}}
      customFieldLoadError={null}
      entryOutcome="join-live"
      allowTeacherSection
      showShareUrl={false}
      hasTeacherCookie={false}
      teacherCode=""
      shareUrl=""
      showTeacherEntryToggle
      isTeacherEntryActive={false}
      onTeacherEntryModeSelect={() => {}}
      onStudentEntryModeSelect={() => {}}
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

  assert.match(html, /I&#x27;m the Teacher/)
  assert.match(html, /Use the teacher code instead of joining as a student/i)
  assert.match(html, /Join Session/)
  assert.match(html, /Display name/)
})

void test('WaitingRoomContent focuses on teacher auth when teacher entry mode is active', () => {
  const html = renderToStaticMarkup(
    <WaitingRoomContent
      activityDisplayName="SyncDeck"
      waiterCount={0}
      error={null}
      isSubmitting={false}
      waitingRoomFields={sampleFields}
      waitingRoomValues={{ displayName: '', team: '' }}
      touchedFields={{}}
      waitingRoomErrors={{}}
      customFieldComponents={{}}
      customFieldLoadError={null}
      entryOutcome="join-live"
      allowTeacherSection
      showShareUrl={false}
      hasTeacherCookie={false}
      teacherCode=""
      shareUrl=""
      showTeacherEntryToggle
      isTeacherEntryActive
      onTeacherEntryModeSelect={() => {}}
      onStudentEntryModeSelect={() => {}}
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

  assert.match(html, /Teacher access/)
  assert.match(html, /Join as Student Instead/)
  assert.match(html, /Enter teacher code/)
  assert.doesNotMatch(html, /Join Session/)
  assert.doesNotMatch(html, /Display name/)
})

void test('WaitingRoomContent hides share footer for students and shows it for remembered teachers', () => {
  const studentHtml = renderToStaticMarkup(
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
      entryOutcome="wait"
      allowTeacherSection
      showShareUrl
      hasTeacherCookie={false}
      teacherCode=""
      shareUrl="https://bits.example/activity/java-string-practice/hash"
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

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
      entryOutcome="wait"
      allowTeacherSection
      showShareUrl
      hasTeacherCookie
      teacherCode=""
      shareUrl="https://bits.example/activity/java-string-practice/hash"
      onTeacherCodeChange={() => {}}
      onTeacherCodeSubmit={(event) => {
        event.preventDefault()
      }}
      onPrimaryAction={() => {}}
      onFieldChange={() => {}}
      onFieldBlur={() => {}}
    />,
  )

  assert.doesNotMatch(studentHtml, /Share this link:/)
  assert.match(html, /Share this link:/)
})
