/**
 * formatUtils.js - Utilities for Java format string evaluation and normalization
 * 
 * This module provides:
 * - Format string evaluation (evaluateFormatString)
 * - Output and mask normalization for comparison (normalizeOutput, normalizeMask)
 * 
 * Note: These normalization functions are for COMPARISON purposes.
 * For DISPLAY purposes (showing newlines as ↵ symbols), components should
 * use their own display-specific transformations.
 */

/**
 * Evaluate a Java format string with given arguments.
 * Supports common format specifiers: %s, %d, %f, %n, %%
 * Also handles width and precision: %-20s, %3d, %.2f, %6.2f, %03d, etc.
 */
export function evaluateFormatString(formatStr, args = []) {
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

/**
 * Normalize output text for comparison.
 * Converts %n to actual newlines and normalizes line endings to \n.
 * This ensures consistent comparison between expected and actual output.
 */
export function normalizeOutput(text) {
  return (text || '').replace(/%n/g, '\n').replace(/\r\n/g, '\n');
}

/**
 * Normalize mask for comparison.
 * Normalizes line endings to \n.
 * Masks should only contain 'S' (static), 'V' (value), or 'D' (dynamic) characters,
 * but this handles any potential line ending inconsistencies.
 */
export function normalizeMask(mask) {
  return (mask || '').replace(/\r\n/g, '\n');
}
