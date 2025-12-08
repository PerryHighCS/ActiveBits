/**
 * Safe expression evaluator for student input
 * Supports basic arithmetic, variable references, and Java type casts
 * Does NOT support function calls or any other dangerous operations
 */

/**
 * Tokenize an expression into meaningful pieces
 */
function tokenize(expr) {
  const tokens = [];
  let current = '';
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Whitespace - skip
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }

    // Operators and delimiters
    if (/[+\-*/%().]/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
      i++;
      continue;
    }

    // Numbers
    if (/\d/.test(char)) {
      current += char;
      i++;
      continue;
    }

    // Identifiers (variable names, keywords)
    if (/[a-zA-Z_]/.test(char)) {
      current += char;
      i++;
      continue;
    }

    // Unknown character - skip
    i++;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Safely evaluate a mathematical expression with variables
 * Supports: +, -, *, /, %, parentheses, variables, numbers, string literals
 * Supports Java casts: (int), (long), (float), (double)
 */
export function safeEvaluate(expression, valueMap = {}) {
  const trimmed = expression.trim();
  if (!trimmed) return '';

  try {
    // Handle string literals first
    let processedExpr = trimmed;
    const stringLiterals = [];
    let stringIndex = 0;

    // Extract string literals and replace with placeholders
    processedExpr = processedExpr.replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, (match) => {
      stringLiterals.push(match);
      return `__STRING_${stringIndex}__`;
    });

    // If the entire expression was a string literal, return its value
    if (stringIndex > 0 && processedExpr.trim() === `__STRING_0__` && stringLiterals.length === 1) {
      // Remove quotes and return the string value
      return stringLiterals[0].slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }

    // Handle Java type casts by preprocessing the expression
    // Replace Java casts - we'll handle them after tokenization
    const castRegex = /\((int|long|float|double)\)\s*/g;
    const casts = [];
    let castIndex = 0;

    processedExpr = processedExpr.replace(castRegex, () => {
      casts.push(`__CAST_${castIndex}__`);
      return casts[castIndex++];
    });

    // Tokenize
    const tokens = tokenize(processedExpr);

    // Validate tokens - ensure all identifiers are either known variables or casts
    for (const token of tokens) {
      if (/^[a-zA-Z_]/.test(token)) {
        // It's an identifier
        if (!(/^__CAST_\d+__$/.test(token) || /^__STRING_\d+__$/.test(token) || token in valueMap)) {
          throw new Error(`Unknown variable: ${token}`);
        }
      }
    }

    // Build the JavaScript expression by replacing casts with Math.trunc
    let jsExpr = processedExpr;
    for (let i = 0; i < casts.length; i++) {
      jsExpr = jsExpr.replace(`__CAST_${i}__`, 'Math.trunc(');
    }

    // Restore string literals
    for (let i = 0; i < stringLiterals.length; i++) {
      jsExpr = jsExpr.replace(`__STRING_${i}__`, stringLiterals[i]);
    }

    // Add closing parentheses for Math.trunc calls
    jsExpr = jsExpr + ')'.repeat(casts.length);

    // Validate the expression structure using a simple recursive descent parser
    validateExpressionSyntax(jsExpr);

    // Evaluate using Function constructor with strict variable mapping
    const keys = Object.keys(valueMap);
    const vals = Object.values(valueMap);

    // Create the function with explicit parameters and Math available
    const fn = new Function('Math', ...keys, `return ${jsExpr};`);
    return fn(Math, ...vals);
  } catch (err) {
    console.warn('Failed to evaluate expression:', expression, err.message);
    return '';
  }
}

/**
 * Validate expression syntax to prevent code injection
 * Checks for disallowed patterns
 */
function validateExpressionSyntax(expr) {
  // Disallow any function calls except Math.trunc and Math.round which we allow
  const allowedMathFunctions = /Math\.(trunc|round)\(/g;
  const exprWithoutAllowedCalls = expr.replace(allowedMathFunctions, '');
  if (/[a-zA-Z_]\w*\s*\(/.test(exprWithoutAllowedCalls)) {
    throw new Error('Function calls are not allowed');
  }

  // Disallow array/object access
  if (/[\[\{]/.test(expr)) {
    throw new Error('Array and object literals are not allowed');
  }

  // Disallow reserved keywords that could be dangerous
  const dangerousKeywords = ['eval', 'Function', 'constructor', 'prototype', '__proto__', 'import', 'export'];
  for (const keyword of dangerousKeywords) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(expr)) {
      throw new Error(`Keyword '${keyword}' is not allowed`);
    }
  }

  // Ensure balanced parentheses
  let parenCount = 0;
  for (const char of expr) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) {
      throw new Error('Unbalanced parentheses');
    }
  }
  if (parenCount !== 0) {
    throw new Error('Unbalanced parentheses');
  }
}
