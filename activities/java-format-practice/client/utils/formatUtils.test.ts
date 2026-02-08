/**
 * Test file for formatUtils.js normalization functions
 */

import { normalizeOutput, normalizeMask } from './formatUtils';

console.log('=== Testing normalizeOutput ===');
const outputTests = [
  {
    name: 'Converts %n to newline',
    input: 'Hello%nWorld',
    expected: 'Hello\nWorld'
  },
  {
    name: 'Normalizes CRLF to LF',
    input: 'Hello\r\nWorld',
    expected: 'Hello\nWorld'
  },
  {
    name: 'Handles both %n and CRLF',
    input: 'Line1%nLine2\r\nLine3',
    expected: 'Line1\nLine2\nLine3'
  },
  {
    name: 'Handles null/undefined',
    input: null,
    expected: ''
  },
  {
    name: 'Empty string unchanged',
    input: '',
    expected: ''
  },
  {
    name: 'String without special chars unchanged',
    input: 'Hello World',
    expected: 'Hello World'
  },
  {
    name: 'Multiple %n sequences',
    input: 'A%nB%nC%nD',
    expected: 'A\nB\nC\nD'
  },
  {
    name: 'Mixed newlines and %n',
    input: 'Line1\nLine2%nLine3\r\nLine4',
    expected: 'Line1\nLine2\nLine3\nLine4'
  }
];

let passed = 0;
let failed = 0;

outputTests.forEach(test => {
  const result = normalizeOutput(test.input);
  if (result === test.expected) {
    passed++;
    console.log(`✓ ${test.name}`);
  } else {
    failed++;
    console.error(`✗ ${test.name}`);
    console.error(`  Input:    ${JSON.stringify(test.input)}`);
    console.error(`  Expected: ${JSON.stringify(test.expected)}`);
    console.error(`  Got:      ${JSON.stringify(result)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed out of ${outputTests.length} normalizeOutput tests`);

console.log('\n=== Testing normalizeMask ===');
const maskTests = [
  {
    name: 'Normalizes CRLF to LF',
    input: 'SSS\r\nVVV',
    expected: 'SSS\nVVV'
  },
  {
    name: 'Handles null/undefined',
    input: null,
    expected: ''
  },
  {
    name: 'Empty string unchanged',
    input: '',
    expected: ''
  },
  {
    name: 'Mask without newlines unchanged',
    input: 'SSSSVVVDDD',
    expected: 'SSSSVVVDDD'
  },
  {
    name: 'Does NOT convert %n (masks should not contain %n)',
    input: 'SSS%nVVV',
    expected: 'SSS%nVVV'
  },
  {
    name: 'Multiple CRLF sequences',
    input: 'S\r\nV\r\nD',
    expected: 'S\nV\nD'
  },
  {
    name: 'LF already normalized stays unchanged',
    input: 'SSS\nVVV\nDDD',
    expected: 'SSS\nVVV\nDDD'
  }
];

let maskPassed = 0;
let maskFailed = 0;

maskTests.forEach(test => {
  const result = normalizeMask(test.input);
  if (result === test.expected) {
    maskPassed++;
    console.log(`✓ ${test.name}`);
  } else {
    maskFailed++;
    console.error(`✗ ${test.name}`);
    console.error(`  Input:    ${JSON.stringify(test.input)}`);
    console.error(`  Expected: ${JSON.stringify(test.expected)}`);
    console.error(`  Got:      ${JSON.stringify(result)}`);
  }
});

console.log(`\n${maskPassed} passed, ${maskFailed} failed out of ${maskTests.length} normalizeMask tests`);

const totalFailed = failed + maskFailed;
console.log(`\n=== Total: ${passed + maskPassed} passed, ${totalFailed} failed ===`);
process.exit(totalFailed > 0 ? 1 : 0);
