import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateFormatString } from './utils/formatUtils.js'

interface EvaluateCase {
  name: string
  format: string
  args: unknown[]
  expected: string
}

const cases: EvaluateCase[] = [
  { name: 'basic %s', format: '%s', args: ['hello'], expected: 'hello' },
  { name: 'basic %d', format: '%d', args: [42], expected: '42' },
  { name: 'basic %.2f', format: '%.2f', args: [3.14159], expected: '3.14' },
  { name: 'left align %-15s', format: '%-15s | test', args: ['admin'], expected: 'admin           | test' },
  { name: 'right align %2d', format: 'Failed: %2d', args: [3], expected: 'Failed:  3' },
  { name: 'zero pad %03d', format: '%03d', args: [7], expected: '007' },
  { name: 'uppercase hex %04X', format: '%04X', args: [48879], expected: 'BEEF' },
  { name: 'lowercase hex %04x', format: '%04x', args: [48879], expected: 'beef' },
  { name: 'multiple placeholders', format: 'Name: %s, Age: %d', args: ['Alice', 30], expected: 'Name: Alice, Age: 30' },
  { name: 'newline %n', format: 'Line 1%nLine 2', args: [], expected: 'Line 1\nLine 2' },
  {
    name: 'intermediate line 1',
    format: '%-15s | Attempting access%n',
    args: ['admin'],
    expected: 'admin           | Attempting access\n',
  },
  {
    name: 'intermediate line 2',
    format: 'Failed: %2d | Level: %2d%n',
    args: [3, 9],
    expected: 'Failed:  3 | Level:  9\n',
  },
  {
    name: 'intermediate line 3',
    format: 'Timestamp: %.2f seconds%n',
    args: [1621.847],
    expected: 'Timestamp: 1621.85 seconds\n',
  },
]

void test('evaluateFormatString handles baseline formatting cases', () => {
  for (const caseItem of cases) {
    const actual = evaluateFormatString(caseItem.format, caseItem.args)
    assert.equal(actual, caseItem.expected, caseItem.name)
  }
})
