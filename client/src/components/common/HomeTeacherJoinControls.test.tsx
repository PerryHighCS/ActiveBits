import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HomeTeacherJoinControls from './HomeTeacherJoinControls'

void React

void test('HomeTeacherJoinControls renders the teacher join trigger when closed', () => {
  const html = renderToStaticMarkup(
    <HomeTeacherJoinControls
      open={false}
      sessionId=""
      teacherCode=""
      error={null}
      isSubmitting={false}
      onOpen={() => {}}
      onClose={() => {}}
      onSessionIdChange={() => {}}
      onTeacherCodeChange={() => {}}
      onSubmit={(event) => {
        event.preventDefault()
      }}
    />,
  )

  assert.match(html, /Teacher Join/)
  assert.doesNotMatch(html, /Join as Teacher/)
})

void test('HomeTeacherJoinControls renders modal fields and error when open', () => {
  const html = renderToStaticMarkup(
    <HomeTeacherJoinControls
      open
      sessionId="35f4e"
      teacherCode="teacher-secret"
      error="Invalid teacher code"
      isSubmitting={false}
      onOpen={() => {}}
      onClose={() => {}}
      onSessionIdChange={() => {}}
      onTeacherCodeChange={() => {}}
      onSubmit={(event) => {
        event.preventDefault()
      }}
    />,
  )

  assert.match(html, /Teacher Join/)
  assert.match(html, /Session ID/)
  assert.match(html, /Teacher code/)
  assert.match(html, /Join as Teacher/)
  assert.match(html, /Invalid teacher code/)
})
