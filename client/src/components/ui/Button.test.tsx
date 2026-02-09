import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import Button from './Button'
import { resolveButtonVariantClass } from './buttonStyles'

void test('resolveButtonVariantClass returns expected classes for known variants', () => {
  assert.match(resolveButtonVariantClass('default'), /bg-blue-500/)
  assert.match(resolveButtonVariantClass('outline'), /border-blue-500/)
  assert.match(resolveButtonVariantClass('text'), /text-blue-500/)
})

void test('resolveButtonVariantClass warns and returns empty class for unknown variant', () => {
  const warnings: string[] = []
  const className = resolveButtonVariantClass('fancy', (message) => {
    warnings.push(message)
  })

  assert.equal(className, '')
  assert.deepEqual(warnings, ['Unknown variant: fancy'])
})

void test('Button renders default type and disabled styling', () => {
  const html = renderToStaticMarkup(
    <Button disabled className="extra-class">
      Save
    </Button>,
  )

  assert.match(html, /type="button"/)
  assert.match(html, /opacity-50/)
  assert.match(html, /cursor-not-allowed/)
  assert.match(html, /extra-class/)
  assert.match(html, />Save</)
})
