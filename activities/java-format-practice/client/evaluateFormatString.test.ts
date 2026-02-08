// @ts-nocheck
// Migration workaround (owner: codex): script-style smoke test retained during TS migration.
// Cleanup: rewrite to typed node:test assertions and remove ts-nocheck in Phase 7.
export {}

// Test file for evaluateFormatString function
// This allows testing the format string evaluation logic independently

function evaluateFormatString(formatStr, args = []) {
  if (!formatStr) return '';
  
  let result = '';
  let argIndex = 0;
  let i = 0;
  
  while (i < formatStr.length) {
    if (formatStr[i] === '%' && i + 1 < formatStr.length) {
      const next = formatStr[i + 1];
      
      if (next === '%') {
        result += '%';
        i += 2;
      } else if (next === 'n') {
        result += '\n';
        i += 2;
      } else if (next === 's') {
        // Simple string format: %s
        if (argIndex < args.length) {
          result += String(args[argIndex]);
          argIndex++;
        }
        i += 2;
      } else if (next === 'd') {
        // Simple integer format: %d
        if (argIndex < args.length) {
          result += String(parseInt(args[argIndex]) || 0);
          argIndex++;
        }
        i += 2;
      } else if (next === 'f') {
        // Simple float format: %f (default 6 decimals)
        if (argIndex < args.length) {
          result += parseFloat(args[argIndex]).toFixed(6);
          argIndex++;
        }
        i += 2;
      } else {
        // Handle width and precision specifiers like %10s, %.2f, %-20s, %6.2f, %3d, %03d, etc.
        let j = i + 1;
        let spec = '';
        
        // Collect format spec characters (-, +, 0, #, space, digits, .)
        while (j < formatStr.length && '0123456789.-+ #'.includes(formatStr[j])) {
          spec += formatStr[j];
          j++;
        }
        
        if (j < formatStr.length) {
          const type = formatStr[j];
          
          if (type === 's' && argIndex < args.length) {
            // String with width/alignment: %-20s, %10s, etc.
            const str = String(args[argIndex]);
            const match = spec.match(/^(-?)(\d+)?$/);
            if (match) {
              const [, leftAlign, width] = match;
              const w = parseInt(width) || 0;
              if (leftAlign) {
                result += str.padEnd(w);
              } else {
                result += str.padStart(w);
              }
            } else {
              result += str;
            }
            argIndex++;
            i = j + 1;
          } else if (type === 'd' && argIndex < args.length) {
            // Integer with width: %3d, %03d, %2d, etc.
            const num = String(parseInt(args[argIndex]) || 0);
            const match = spec.match(/^(0)?(\d+)?$/);
            if (match) {
              const [, padZero, width] = match;
              const w = parseInt(width) || 0;
              if (padZero) {
                result += num.padStart(w, '0');
              } else {
                result += num.padStart(w);
              }
            } else {
              result += num;
            }
            argIndex++;
            i = j + 1;
          } else if (type === 'f' && argIndex < args.length) {
            // Float with width and precision: %6.2f, %.2f, %10.2f, etc.
            const num = parseFloat(args[argIndex]) || 0;
            const match = spec.match(/^(-?)(\d*)\.(\d+)$/);
            if (match) {
              const [, leftAlign, width, precision] = match;
              const p = parseInt(precision) || 6;
              const w = parseInt(width) || 0;
              let formatted = num.toFixed(p);
              if (leftAlign) {
                formatted = formatted.padEnd(w);
              } else {
                formatted = formatted.padStart(w);
              }
              result += formatted;
            } else {
              result += num.toFixed(6);
            }
            argIndex++;
            i = j + 1;
          } else {
            result += formatStr[i];
            i++;
          }
        } else {
          result += formatStr[i];
          i++;
        }
      }
    } else {
      result += formatStr[i];
      i++;
    }
  }
  
  return result;
}

// Test cases
const tests = [
  // Basic string format
  {
    name: 'Basic %s format',
    format: '%s',
    args: ['hello'],
    expected: 'hello'
  },
  // Basic integer format
  {
    name: 'Basic %d format',
    format: '%d',
    args: [42],
    expected: '42'
  },
  // Basic float format
  {
    name: 'Basic %f format',
    format: '%.2f',
    args: [3.14159],
    expected: '3.14'
  },
  // Left-aligned string
  {
    name: 'Left-aligned string %-15s',
    format: '%-15s | test',
    args: ['admin'],
    expected: 'admin           | test'
  },
  // Right-aligned integer
  {
    name: 'Right-aligned integer %2d',
    format: 'Failed: %2d',
    args: [3],
    expected: 'Failed:  3'
  },
  // Zero-padded integer
  {
    name: 'Zero-padded integer %03d',
    format: '%03d',
    args: [7],
    expected: '007'
  },
  // Multiple format specifiers
  {
    name: 'Multiple specifiers',
    format: 'Name: %s, Age: %d',
    args: ['Alice', 30],
    expected: 'Name: Alice, Age: 30'
  },
  // With newline
  {
    name: 'With newline %n',
    format: 'Line 1%nLine 2',
    args: [],
    expected: 'Line 1\nLine 2'
  },
  // Intermediate example: hacker terminal
  {
    name: 'Hacker terminal line 1',
    format: '%-15s | Attempting access%n',
    args: ['admin'],
    expected: 'admin           | Attempting access\n'
  },
  // Intermediate example: multiple integers
  {
    name: 'Hacker terminal line 2',
    format: 'Failed: %2d | Level: %2d%n',
    args: [3, 9],
    expected: 'Failed:  3 | Level:  9\n'
  },
  // Intermediate example: float precision
  {
    name: 'Hacker terminal line 3',
    format: 'Timestamp: %.2f seconds%n',
    args: [1621.847],
    expected: 'Timestamp: 1621.85 seconds\n'
  },
];

// Run tests
let passed = 0;
let failed = 0;

tests.forEach(test => {
  const result = evaluateFormatString(test.format, test.args);
  const success = result === test.expected;
  
  if (success) {
    passed++;
    console.log(`✓ ${test.name}`);
  } else {
    failed++;
    console.error(`✗ ${test.name}`);
    console.error(`  Format: ${test.format}`);
    console.error(`  Args: ${JSON.stringify(test.args)}`);
    console.error(`  Expected: ${JSON.stringify(test.expected)}`);
    console.error(`  Got:      ${JSON.stringify(result)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
process.exit(failed > 0 ? 1 : 0);
