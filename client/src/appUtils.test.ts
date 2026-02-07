import test from 'node:test'
import assert from 'node:assert/strict'
import { findFooterActivity } from './appUtils'

test('findFooterActivity returns activity with footer for manage paths', () => {
  const footerComponent = () => null
  const activities = [
    { id: 'raffle', name: 'Raffle', description: 'R', color: 'blue', soloMode: false },
    {
      id: 'gallery-walk',
      name: 'Gallery',
      description: 'G',
      color: 'green',
      soloMode: true,
      FooterComponent: footerComponent,
    },
  ]

  const result = findFooterActivity('/manage/gallery-walk/abc123', activities)
  assert.equal(result?.id, 'gallery-walk')
})

test('findFooterActivity returns null when no footer component is available', () => {
  const activities = [{ id: 'raffle', name: 'Raffle', description: 'R', color: 'blue', soloMode: false }]

  const result = findFooterActivity('/manage/raffle/abc123', activities)
  assert.equal(result, null)
})
