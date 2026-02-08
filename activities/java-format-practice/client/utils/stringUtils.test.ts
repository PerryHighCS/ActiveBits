/**
 * Test file for stringUtils.js
 * Focuses on splitArgumentsRespectingQuotes function with format specifiers
 */

import { splitArgumentsRespectingQuotes, escapeHtml, highlightDiff } from './stringUtils.js';

// Test cases
const tests = [
  // Basic quoted strings with commas
  {
    name: 'Quoted string with comma',
    input: '"Hello, World", name, 42',
    expected: ['"Hello, World"', 'name', '42']
  },
  
  // Format specifiers with grouping separator
  {
    name: 'Single format specifier with grouping comma',
    input: 'Reward: $%,d, bounty',
    expected: ['Reward: $%,d', 'bounty']
  },
  
  // Multiple format specifiers with commas
  {
    name: 'Multiple format specifiers with grouping comma',
    input: 'Total: %,d, Count: %,d, Result',
    expected: ['Total: %,d', 'Count: %,d', 'Result']
  },
  
  // Quoted string with format specifier in the format string itself
  {
    name: 'Quoted string with format specifier containing comma',
    input: '"Total: %,d", value, %10,d, other',
    expected: ['"Total: %,d"', 'value', '%10,d', 'other']
  },
  
  // Format specifier with width and grouping separator
  {
    name: 'Format specifier with width and grouping comma',
    input: 'Price: $%10,d, Item: %s',
    expected: ['Price: $%10,d', 'Item: %s']
  },
  
  // Format specifier with flags and grouping separator
  {
    name: 'Format specifier with flag and grouping comma',
    input: 'Value: %+,d, Status: OK',
    expected: ['Value: %+,d', 'Status: OK']
  },
  
  // Format specifier with zero padding and grouping separator
  {
    name: 'Format specifier with zero padding and grouping comma',
    input: 'Code: %010,d, Name',
    expected: ['Code: %010,d', 'Name']
  },
  
  // Regular comma after regular conversion character (should split)
  {
    name: 'Comma after %s should split',
    input: '%s, %,d',
    expected: ['%s', '%,d']
  },
  
  // Comma after %d without format flag (should split)
  {
    name: 'Comma after %d without grouping flag should split',
    input: 'Count: %d, Total: %,d',
    expected: ['Count: %d', 'Total: %,d']
  },
  
  // Edge case: multiple commas in quoted string
  {
    name: 'Multiple commas in quoted string',
    input: '"A, B, C", %,d, done',
    expected: ['"A, B, C"', '%,d', 'done']
  },
  
  // Edge case: format specifier at the end
  {
    name: 'Format specifier at the end',
    input: 'Prefix, Value: %,d',
    expected: ['Prefix', 'Value: %,d']
  },
  
  // Edge case: only a format specifier with comma
  {
    name: 'Only format specifier with comma',
    input: '%,d',
    expected: ['%,d']
  },
  
  // Edge case: consecutive commas (malformed, but should handle gracefully)
  // The first comma is part of the format specifier (between % and the next comma),
  // the second comma is a separator, and 'd' becomes a standalone part
  {
    name: 'Malformed format specifier with double comma',
    input: 'Value: %,,d, other',
    expected: ['Value: %', '', 'd', 'other']
  },
  
  // Edge case: comma without percent sign before (should split)
  {
    name: 'Comma in regular text should split',
    input: 'Name, Value, Status',
    expected: ['Name', 'Value', 'Status']
  },
  
  // Complex: mixed quoted strings and format specifiers
  {
    name: 'Complex: quoted string with format specifier and arguments',
    input: '"Name: %s", john, "Count: %,d", 1000',
    expected: ['"Name: %s"', 'john', '"Count: %,d"', '1000']
  },
  
  // Format specifier with precision and grouping separator
  {
    name: 'Format specifier with precision and grouping comma',
    input: 'Price: $%10.2f, Amount: %,d',
    expected: ['Price: $%10.2f', 'Amount: %,d']
  },
  
  // Format specifier with left alignment and grouping separator
  {
    name: 'Format specifier with left alignment and grouping comma',
    input: 'Item: %-15s, Price: $%,d',
    expected: ['Item: %-15s', 'Price: $%,d']
  },
  
  // Escaped quote (should not toggle quote state)
  {
    name: 'Escaped quote in string',
    input: '"Say \\"hello\\", world", value',
    expected: ['"Say \\"hello\\", world"', 'value']
  },
  
  // Format specifier with plus flag and grouping separator
  {
    name: 'Format specifier with plus flag and grouping comma',
    input: 'Balance: %+,d, Status: active',
    expected: ['Balance: %+,d', 'Status: active']
  },
  
  // Multiple consecutive format specifiers
  {
    name: 'Multiple consecutive format specifiers with commas',
    input: '%,d, %,d, %,d',
    expected: ['%,d', '%,d', '%,d']
  }
];

// Run tests
let passed = 0;
let failed = 0;

// Helper function for robust array equality check
function arraysEqual(arr1: unknown[], arr2: unknown[]) {
  // Check if both are arrays
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
    return false;
  }
  
  // Check if lengths match
  if (arr1.length !== arr2.length) {
    return false;
  }
  
  // Check each element (handles strings, numbers, and other primitives)
  for (let i = 0; i < arr1.length; i++) {
    // Use strict equality for primitive values and array elements
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  
  return true;
}

tests.forEach(test => {
  const result = splitArgumentsRespectingQuotes(test.input);
  const success = arraysEqual(result, test.expected);
  
  if (success) {
    passed++;
    console.log(`✓ ${test.name}`);
  } else {
    failed++;
    console.error(`✗ ${test.name}`);
    console.error(`  Input:    ${test.input}`);
    console.error(`  Expected: ${JSON.stringify(test.expected)}`);
    console.error(`  Got:      ${JSON.stringify(result)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);

// Test escapeHtml function
console.log('\n=== Testing escapeHtml ===');
const escapeTests = [
  { input: 'normal text', expected: 'normal text', name: 'Normal text unchanged' },
  { input: '<script>alert("XSS")</script>', expected: '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;', name: 'Script tags escaped' },
  { input: 'Hello & goodbye', expected: 'Hello &amp; goodbye', name: 'Ampersand escaped' },
  { input: "It's a test", expected: 'It&#039;s a test', name: 'Single quote escaped' },
  { input: '<img src="x" onerror="alert(1)">', expected: '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;', name: 'Image tag with attributes escaped' },
];

let escapePassed = 0;
let escapeFailed = 0;

escapeTests.forEach(test => {
  const result = escapeHtml(test.input);
  if (result === test.expected) {
    escapePassed++;
    console.log(`✓ ${test.name}`);
  } else {
    escapeFailed++;
    console.error(`✗ ${test.name}`);
    console.error(`  Input:    ${test.input}`);
    console.error(`  Expected: ${test.expected}`);
    console.error(`  Got:      ${result}`);
  }
});

console.log(`\n${escapePassed} passed, ${escapeFailed} failed out of ${escapeTests.length} escapeHtml tests`);

// Test highlightDiff with HTML escaping
console.log('\n=== Testing highlightDiff with HTML escaping ===');
const diffTests = [
  {
    name: 'Malicious script in actual value',
    expected: 'Hello World',
    actual: '<script>alert(1)</script>',
    shouldNotContain: '<script>',
    shouldContain: '&lt;script&gt;'
  },
  {
    name: 'Normal strings',
    expected: 'abc',
    actual: 'adc',
    shouldContain: '<span class="diff-highlight">b</span>',
  },
  {
    name: 'HTML in both strings',
    expected: '<div>test</div>',
    actual: '<div>best</div>',
    shouldNotContain: '<div>',
    shouldContain: '&lt;div&gt;'
  }
];

let diffPassed = 0;
let diffFailed = 0;

diffTests.forEach(test => {
  const result = highlightDiff(test.expected, test.actual);
  let success = true;
  
  if (test.shouldNotContain) {
    if (result.expected.includes(test.shouldNotContain) || result.actual.includes(test.shouldNotContain)) {
      success = false;
      console.error(`✗ ${test.name} - Found forbidden string: ${test.shouldNotContain}`);
    }
  }
  
  if (test.shouldContain) {
    if (!result.expected.includes(test.shouldContain) && !result.actual.includes(test.shouldContain)) {
      success = false;
      console.error(`✗ ${test.name} - Missing expected string: ${test.shouldContain}`);
    }
  }
  
  if (success) {
    diffPassed++;
    console.log(`✓ ${test.name}`);
  } else {
    diffFailed++;
    console.error(`  Expected: ${result.expected}`);
    console.error(`  Actual:   ${result.actual}`);
  }
});

console.log(`\n${diffPassed} passed, ${diffFailed} failed out of ${diffTests.length} highlightDiff tests`);

const totalFailed = failed + escapeFailed + diffFailed;
process.exit(totalFailed > 0 ? 1 : 0);
