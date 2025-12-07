// Integration test for intermediate/advanced validation logic

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

// Simulate the validation logic from JavaFormatPractice.jsx
function validateIntermediate(userAnswer, challenge) {
  const variables = challenge.variables;
  const calls = challenge.formatCalls;
  
  let allCorrect = true;
  let feedback = [];
  
  calls.forEach((call, idx) => {
    // Parse format string: look for quoted string containing format specs
    const formatMatch = userAnswer.match(/"([^"]*)"/) || userAnswer.match(/'([^']*)'/) || userAnswer.match(/(\S+)/);
    const formatString = formatMatch ? formatMatch[1] : '';
    
    // Extract variable names: everything after the format string
    const afterFormat = userAnswer.substring(userAnswer.indexOf(formatMatch[0]) + formatMatch[0].length).trim();
    const varNames = afterFormat
      .split(',')
      .map(v => v.trim())
      .filter(v => v.length > 0);
    
    // Look up variable values from challenge.variables
    const varValues = varNames.map(name => {
      const variable = variables.find(v => v.name === name);
      if (!variable) return '';
      
      // Remove quotes if the value is a string
      let value = variable.value;
      if (typeof value === 'string' && (value.startsWith('"') || value.startsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value;
    });
    
    try {
      // Evaluate format string with variables
      const actualOutput = evaluateFormatString(formatString, varValues);
      const expectedOutput = call.expectedOutput || '';
      
      if (actualOutput !== expectedOutput) {
        allCorrect = false;
        feedback.push({
          line: idx + 1,
          expected: expectedOutput,
          actual: actualOutput,
          pass: false
        });
      } else {
        feedback.push({
          line: idx + 1,
          pass: true
        });
      }
    } catch (err) {
      allCorrect = false;
      feedback.push({
        line: idx + 1,
        pass: false,
        error: err.message
      });
    }
  });
  
  return { allCorrect, feedback };
}

// Test scenario 1: Hacker terminal intermediate challenge
console.log('=== Test 1: Hacker Terminal Challenge ===');
const hackerChallenge = {
  variables: [
    { name: 'user', type: 'String', value: '"admin"' },
    { name: 'attempts', type: 'int', value: '3' },
    { name: 'accessLevel', type: 'int', value: '9' },
    { name: 'timestamp', type: 'double', value: '1621.847' },
  ],
  formatCalls: [
    {
      expectedOutput: 'admin           | Attempting access\n',
    },
    {
      expectedOutput: 'Failed:  3 | Level:  9\n',
    },
    {
      expectedOutput: 'Timestamp: 1621.85 seconds\n',
    },
  ],
};

// Simulate correct answer
const userAnswers = [
  '"%-15s | Attempting access%n", user',
  '"Failed: %2d | Level: %2d%n", attempts, accessLevel',
  '"Timestamp: %.2f seconds%n", timestamp',
];

let testsPassed = 0;
let testsFailed = 0;

userAnswers.forEach((answer, idx) => {
  // Patch: set only the expectedOutput for this call
  const singleCallChallenge = {
    variables: hackerChallenge.variables,
    formatCalls: [hackerChallenge.formatCalls[idx]],
  };
  const result = validateIntermediate(answer, singleCallChallenge);
  const lineResult = result.feedback[0];
  
  if (lineResult.pass) {
    testsPassed++;
    console.log(`✓ Line ${idx + 1}: Correct`);
  } else {
    testsFailed++;
    console.error(`✗ Line ${idx + 1}: Incorrect`);
    console.error(`  Expected: ${JSON.stringify(lineResult.expected)}`);
    console.error(`  Got:      ${JSON.stringify(lineResult.actual)}`);
  }
});

// Test scenario 2: Catch spacing errors
console.log('\n=== Test 2: Spacing Error Detection ===');

// This should fail - different width specifier produces same visual output
const wrongSpacingAnswer = '%-10s | Attempting access%n", user';  // 10 instead of 15
const result = validateIntermediate(wrongSpacingAnswer, hackerChallenge);
const lineResult = result.feedback[0];

if (!lineResult.pass) {
  testsPassed++;
  console.log(`✓ Correctly detected spacing error`);
  console.log(`  Expected: ${JSON.stringify(lineResult.expected)}`);
  console.log(`  Got:      ${JSON.stringify(lineResult.actual)}`);
} else {
  testsFailed++;
  console.error(`✗ Failed to detect spacing error`);
}

console.log(`\n${testsPassed} tests passed, ${testsFailed} tests failed`);
process.exit(testsFailed > 0 ? 1 : 0);
