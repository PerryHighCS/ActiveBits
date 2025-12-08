// Test script to verify challenge instantiation works correctly
// Load the required modules
import { CHALLENGE_DEFINITIONS, formatWithMask, evaluateArgs } from './activities/java-format-practice/client/challenges.js';
import { safeEvaluate } from './activities/java-format-practice/client/utils/safeEvaluator.js';

// Test instantiation
function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max, step = 1) {
  const range = Math.floor((max - min) / step);
  return min + Math.floor(Math.random() * (range + 1)) * step;
}

function randomFloat(min, max, precision = 2) {
  const value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(precision));
}

function replacePlaceholders(text, replacements) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{(.*?)\}\}/g, (_, key) => replacements[key] ?? `{{${key}}}`);
}

function padValue(str, width, leftAlign = false, padChar = ' ') {
  if (!width || width <= str.length) return str;
  return leftAlign ? str.padEnd(width, padChar) : str.padStart(width, padChar);
}

function formatNumber(num, precision) {
  if (precision === undefined || precision === null) return String(num);
  return Number(num).toFixed(precision);
}

// Copied splitArguments function
function splitArguments(argStr) {
  const args = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  let parenDepth = 0;
  
  for (let i = 0; i < argStr.length; i++) {
    const char = argStr[i];
    const prevChar = i > 0 ? argStr[i - 1] : '';
    
    // Handle quotes
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      }
      current += char;
    }
    // Handle parentheses (only outside quotes)
    else if (!inQuotes && char === '(') {
      parenDepth++;
      current += char;
    } else if (!inQuotes && char === ')') {
      parenDepth--;
      current += char;
    }
    // Handle comma separator
    else if (!inQuotes && parenDepth === 0 && char === ',') {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    args.push(current.trim());
  }
  
  return args;
}

function instantiate(definition) {
  const replacements = {};
  const valueMap = {};
  const usedNames = new Set();

  const variables = definition.variableTemplates.map((vt) => {
    const nameOptions = vt.names.filter((n) => !usedNames.has(n));
    const chosenName = randomChoice(nameOptions.length ? nameOptions : vt.names);
    usedNames.add(chosenName);
    let chosenValue;
    if (Array.isArray(vt.values)) {
      chosenValue = randomChoice(vt.values);
    } else if (vt.range) {
      const { min, max, step = 1, precision } = vt.range;
      if (vt.type === 'double') {
        chosenValue = randomFloat(min, max, precision);
      } else {
        chosenValue = randomInt(min, max, step);
      }
    } else {
      chosenValue = vt.defaultValue ?? '';
    }

    replacements[vt.key] = chosenName;
    const literal = vt.type === 'String' ? `"${chosenValue}"` : String(chosenValue);
    valueMap[chosenName] = vt.type === 'String' ? String(chosenValue) : Number(chosenValue);

    return {
      name: chosenName,
      type: vt.type,
      value: literal,
    };
  });

  const formatCalls = definition.formatCalls.map((call) => {
    const mappedInputs = (call.inputs || []).map((input) => ({
      ...input,
      expected: replacePlaceholders(input.expected, replacements),
    }));

    return {
      ...call,
      prompt: replacePlaceholders(call.prompt, replacements),
      skeleton: replacePlaceholders(call.skeleton, replacements),
      answer: replacePlaceholders(call.answer, replacements),
      inputs: mappedInputs,
    };
  });

  let expectedOutput = '';
  let expectedOutputMask = '';

  formatCalls.forEach((call, idx) => {
    const answerStr = call.answer || '';
    if (!answerStr.trim()) return;
    
    let formatString = '';
    let argExprs = [];
    
    // Check if format string is quoted (advanced mode)
    if (answerStr.trim().startsWith('"')) {
      // Find the closing quote, accounting for escaped quotes
      let closeQuoteIdx = -1;
      for (let i = 1; i < answerStr.length; i++) {
        if (answerStr[i] === '"' && answerStr[i - 1] !== '\\') {
          closeQuoteIdx = i;
          break;
        }
      }
      
      if (closeQuoteIdx !== -1) {
        formatString = answerStr.slice(1, closeQuoteIdx);
        // Everything after the closing quote and comma
        const rest = answerStr.slice(closeQuoteIdx + 1).trim();
        if (rest.startsWith(',')) {
          // Parse arguments, respecting quotes and parentheses
          const argStr = rest.slice(1);
          argExprs = splitArguments(argStr);
        }
      }
    } else {
      // Unquoted format string (beginner/intermediate mode)
      const separatorIdx = answerStr.indexOf(', ');
      if (separatorIdx !== -1) {
        formatString = answerStr.slice(0, separatorIdx).trim();
        const rest = answerStr.slice(separatorIdx + 1).trim();
        argExprs = splitArguments(rest);
      } else {
        formatString = answerStr.trim();
      }
    }
    
    console.log(`\n[Call ${idx}]`);
    console.log('Format String:', formatString);
    console.log('Arg Expressions:', argExprs);
    
    const argValues = argExprs.map((expr) => safeEvaluate(expr, valueMap));
    console.log('Arg Values:', argValues);
    
    const { text, mask } = formatWithMask(formatString, argValues);
    console.log('Formatted Text:', JSON.stringify(text));
    
    expectedOutput += text;
    expectedOutputMask += mask;
    if (!text.endsWith('\n')) {
      expectedOutput += '\n';
      expectedOutputMask += 'S';
    }
  });

  return {
    ...definition,
    variables,
    formatCalls,
    expectedOutput,
    expectedOutputMask,
  };
}

// Test with the spy-badge-dynamic-advanced challenge
const spyBadgeChallenge = CHALLENGE_DEFINITIONS.find(d => d.id === 'spy-badge-dynamic-advanced');
console.log('Testing challenge:', spyBadgeChallenge.id);
console.log('Number of format calls:', spyBadgeChallenge.formatCalls.length);

const instance = instantiate(spyBadgeChallenge);

console.log('\n\n=== FINAL RESULT ===');
console.log('Expected Output:');
console.log(instance.expectedOutput);
console.log('\nFormatCalls count:', instance.formatCalls.length);
console.log('Expected Output lines:', instance.expectedOutput.split('\n').length - 1);
