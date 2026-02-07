import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import DemoStudent from './DemoStudent'

test('DemoStudent renders solo-mode picker before algorithm selection', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <DemoStudent
        sessionData={{ sessionId: 'solo-algorithm-demo' }}
        persistentSessionInfo={null}
      />
    </MemoryRouter>,
  )

  assert.match(html, /Algorithm Practice/)
  assert.match(html, /Select Algorithm/)
})
