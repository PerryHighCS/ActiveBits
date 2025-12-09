/**
 * Test file for stringUtils.js
 * Focuses on splitArgumentsRespectingQuotes function with format specifiers
 */

import { splitArgumentsRespectingQuotes } from './stringUtils.js';

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
function arraysEqual(arr1, arr2) {
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
process.exit(failed > 0 ? 1 : 0);
