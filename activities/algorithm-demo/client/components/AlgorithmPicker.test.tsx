import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import AlgorithmPicker from './AlgorithmPicker'

void test('AlgorithmPicker renders cards and selected styling', () => {
  const html = renderToStaticMarkup(
    <AlgorithmPicker
      algorithms={[
        { id: 'linear-search', name: 'Linear Search', description: 'Search linearly' },
        { id: 'merge-sort', name: 'Merge Sort', description: 'Sort recursively' },
      ]}
      selectedId="linear-search"
      onSelect={() => {}}
      title="Pick"
    />,
  )

  assert.match(html, /algorithm-card selected/)
  assert.match(html, />Linear Search</)
  assert.match(html, />Merge Sort</)
  assert.equal((html.match(/type="button"/g) ?? []).length, 2)
})

void test('AlgorithmPicker disables entries without ids', () => {
  const html = renderToStaticMarkup(
    <AlgorithmPicker
      algorithms={[
        { name: 'Missing Id', description: 'No id available' },
      ]}
      selectedId={null}
      onSelect={() => {}}
    />,
  )

  assert.match(html, /disabled=""/)
})
