import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import ActivityRoster from './ActivityRoster'
import { buildUniqueRosterRowKeys } from './activityRosterKeys'

test('buildUniqueRosterRowKeys prefers id, then name, then index and enforces uniqueness', () => {
  const keys = buildUniqueRosterRowKeys([
    { id: 'a', name: 'Ada' },
    { id: 'a', name: 'Ada' },
    { name: 'Lin' },
    { name: 'Lin' },
    {},
  ])

  assert.deepEqual(keys, ['id:a', 'id:a:1', 'name:Lin', 'name:Lin:1', 'index:4'])
})

test('ActivityRoster renders empty message when there are no students', () => {
  const html = renderToStaticMarkup(
    <ActivityRoster columns={[{ id: 'name', label: 'Student' }]} />,
  )

  assert.match(html, /No students yet\./)
})

test('ActivityRoster renders loading and error states', () => {
  const loadingHtml = renderToStaticMarkup(
    <ActivityRoster loading columns={[{ id: 'name', label: 'Student' }]} />,
  )
  assert.match(loadingHtml, /Loading…/)

  const errorHtml = renderToStaticMarkup(
    <ActivityRoster
      loading
      error="Network unavailable"
      columns={[{ id: 'name', label: 'Student' }]}
    />,
  )
  assert.match(errorHtml, /Network unavailable/)
  assert.doesNotMatch(errorHtml, /Loading…/)
})

test('ActivityRoster renders rows and sort icons', () => {
  const html = renderToStaticMarkup(
    <ActivityRoster
      students={[
        { id: 's1', name: 'Ada', score: 5 },
        { id: 's2', name: 'Lin', score: 3 },
      ]}
      columns={[
        { id: 'name', label: 'Student' },
        { id: 'score', label: 'Score', align: 'center' },
      ]}
      sortBy="score"
      sortDirection="desc"
      onSort={() => {}}
    />,
  )

  assert.match(html, />Ada</)
  assert.match(html, />Lin</)
  assert.equal((html.match(/<button type="button"/g) ?? []).length, 2)
  assert.equal((html.match(/aria-sort="none"/g) ?? []).length, 1)
  assert.equal((html.match(/aria-sort="descending"/g) ?? []).length, 1)
  assert.match(html, />⇅</)
  assert.match(html, />↑</)
})
