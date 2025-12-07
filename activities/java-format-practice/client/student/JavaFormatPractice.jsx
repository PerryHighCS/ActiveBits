// Highlight the first difference between two strings
function highlightDiff(expected, actual) {
  if (expected === actual) return { expected, actual };
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  // Find end of difference
  let j = 0;
  while (
    j < expected.length - i &&
    j < actual.length - i &&
    expected[expected.length - 1 - j] === actual[actual.length - 1 - j]
  ) j++;
  const expDiff =
    expected.slice(0, i) +
    '<span class="diff-highlight">' + expected.slice(i, expected.length - j) + '</span>' +
    expected.slice(expected.length - j);
  const actDiff =
    actual.slice(0, i) +
    '<span class="diff-highlight">' + actual.slice(i, actual.length - j) + '</span>' +
    actual.slice(actual.length - j);
  return { expected: expDiff, actual: actDiff };
}
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import '../components/styles.css';
import ChallengeSelector from '../components/ChallengeSelector';
import CharacterGrid from '../components/CharacterGrid';
import AnswerSection from '../components/AnswerSection';
import FeedbackDisplay from '../components/FeedbackDisplay';
import StatsPanel from '../components/StatsPanel';
import ChallengeQuestion from '../components/ChallengeQuestion';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

/**
 * Evaluate a Java format string with given arguments
 * Supports common format specifiers: %s, %d, %f, %n, %%
 * Also handles width and precision: %-20s, %3d, %.2f, %6.2f, %03d, etc.
 */
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

// Local challenge data (embedded directly for client-side use)
// In a production app, these could also be fetched from the server
const PRESET_CHALLENGES = [
  {
    id: 'wanted-poster-beginner',
    title: 'Wanted Poster - Basic Info',
    difficulty: 'beginner',
    theme: 'wanted-poster',
    scenario: 'Create a wanted poster for a fictional criminal. Complete each line of the poster by choosing the right format specifier.',
    variables: [
      { name: 'name', type: 'String', value: '"The Bandit"' },
      { name: 'crime', type: 'String', value: '"Grand Theft"' },
      { name: 'reward', type: 'int', value: '5000' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Print the title "WANTED" with a newline',
        skeleton: 'System.out.printf("%s%n", "WANTED");',
        answer: '%s%n, WANTED',
        inputs: [
          { type: 'format-string', expected: '%s%n' },
          { type: 'string-literal', expected: 'WANTED' },
        ],
        explanation: '%s formats string values, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Print the criminal name',
        skeleton: 'System.out.printf("Name: %s%n", name);',
        answer: 'Name: %s%n, name',
        inputs: [
          { type: 'format-string', expected: 'Name: %s%n' },
          { type: 'variable', expected: 'name' },
        ],
        explanation: 'Use %s for the name variable, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Print the crime',
        skeleton: 'System.out.printf("Crime: %s%n", crime);',
        answer: 'Crime: %s%n, crime',
        inputs: [
          { type: 'format-string', expected: 'Crime: %s%n' },
          { type: 'variable', expected: 'crime' },
        ],
        explanation: 'Another string using %s, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Print the reward amount',
        skeleton: 'System.out.printf("Reward: $%d%n", reward);',
        answer: 'Reward: $%d%n, reward',
        inputs: [
          { type: 'format-string', expected: 'Reward: $%d%n' },
          { type: 'variable', expected: 'reward' },
        ],
        explanation: '%d formats integers without decimals, %n for newline',
      },
    ],
    expectedOutput: 'WANTED\nName: The Bandit\nCrime: Grand Theft\nReward: $5000\n',
    hints: [
      'Use %d for integers (whole numbers)',
      'Use %s for strings (text)',
      'Use %n as the newline format specifier in printf strings',
    ],
    gridWidth: 30,
    gridHeight: 5,
  },
  {
    id: 'restaurant-menu-beginner',
    title: 'Restaurant Menu - Price Display',
    difficulty: 'beginner',
    theme: 'restaurant-menu',
    scenario: 'Build a restaurant menu listing items and their prices. Each line of the menu is a separate format challenge.',
    variables: [
      { name: 'dish1', type: 'String', value: '"Spaghetti Carbonara"' },
      { name: 'price1', type: 'double', value: '12.99' },
      { name: 'dish2', type: 'String', value: '"Tiramisu"' },
      { name: 'price2', type: 'double', value: '6.50' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display first dish name',
        skeleton: 'System.out.printf("%s%n", dish1);',
        answer: '%s%n, dish1',
        inputs: [
          { type: 'format-string', expected: '%s%n' },
          { type: 'variable', expected: 'dish1' },
        ],
        explanation: '%s formats string values, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Display first price with 2 decimal places',
        skeleton: 'System.out.printf("Price: $%.2f%n", price1);',
        answer: 'Price: $%.2f%n, price1',
        inputs: [
          { type: 'format-string', expected: 'Price: $%.2f%n' },
          { type: 'variable', expected: 'price1' },
        ],
        explanation: '%.2f formats decimals with exactly 2 places, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Display second dish name',
        skeleton: 'System.out.printf("%s%n", dish2);',
        answer: '%s%n, dish2',
        inputs: [
          { type: 'format-string', expected: '%s%n' },
          { type: 'variable', expected: 'dish2' },
        ],
        explanation: 'Use %s for another string, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 4: Display second price',
        skeleton: 'System.out.printf("Price: $%.2f%n", price2);',
        answer: 'Price: $%.2f%n, price2',
        inputs: [
          { type: 'format-string', expected: 'Price: $%.2f%n' },
          { type: 'variable', expected: 'price2' },
        ],
        explanation: 'Same format for consistency, %n for newline',
      },
    ],
    expectedOutput: 'Spaghetti Carbonara\nPrice: $12.99\nTiramisu\nPrice: $6.50\n',
    hints: [
      'Use %.2f to display money with 2 decimal places',
      'The number after the dot controls decimal precision',
      'Use %n as the newline format specifier to separate lines',
    ],
    gridWidth: 30,
    gridHeight: 5,
  },
  {
    id: 'diagnostic-panel-beginner',
    title: 'System Diagnostic - Status Display',
    difficulty: 'beginner',
    theme: 'diagnostic-panel',
    scenario: 'Create a system diagnostic display showing various statuses and percentages. Each line is a separate format call.',
    variables: [
      { name: 'progress', type: 'int', value: '85' },
      { name: 'status', type: 'String', value: '"INITIALIZING"' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display the system component name (constant)',
        skeleton: 'System.out.printf("System Boot%n");',
        answer: 'System Boot%n',
        inputs: [
          { type: 'constant-string', expected: 'System Boot%n' },
        ],
        explanation: 'No format specifiers needed for a constant string, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Display progress as percentage',
        skeleton: 'System.out.printf("Progress: %d%%%n", progress);',
        answer: 'Progress: %d%%%n, progress',
        inputs: [
          { type: 'format-string', expected: 'Progress: %d%%%n' },
          { type: 'variable', expected: 'progress' },
        ],
        explanation: '%d formats integers, %% outputs literal percent sign, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Display status message from variable',
        skeleton: 'System.out.printf("Status: %s%n", status);',
        answer: 'Status: %s%n, status',
        inputs: [
          { type: 'format-string', expected: 'Status: %s%n' },
          { type: 'variable', expected: 'status' },
        ],
        explanation: 'Use %s for the status variable, %n for newline',
      },
    ],
    expectedOutput: 'System Boot\nProgress: 85%\nStatus: INITIALIZING\n',
    hints: [
      'Use %% to print a literal percent sign',
      'A single % starts a format specifier, so %% escapes it',
      'Use %n as the newline format specifier in printf',
    ],
    gridWidth: 30,
    gridHeight: 4,
  },
  {
    id: 'hacker-terminal-intermediate',
    title: 'Hacker Terminal - System Override',
    difficulty: 'intermediate',
    theme: 'hacker-terminal',
    scenario: 'Create a hacker terminal display simulating system override. Each line shows a different access attempt with field alignment.',
    variables: [
      { name: 'user', type: 'String', value: '"admin"' },
      { name: 'attempts', type: 'int', value: '3' },
      { name: 'accessLevel', type: 'int', value: '9' },
      { name: 'timestamp', type: 'double', value: '1621.847' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display header with user name left-aligned',
        skeleton: 'System.out.printf("%-15s | Attempting access%n", user);',
        answer: '%-15s | Attempting access%n", user',
        inputs: [
          { type: 'format-string', expected: '%-15s | Attempting access%n' },
          { type: 'variable', expected: 'user' },
        ],
        explanation: '%-15s left-aligns string in 15 character field, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Show failed attempts and access level right-aligned',
        skeleton: 'System.out.printf("Failed: %2d | Level: %2d%n", attempts, accessLevel);',
        answer: '%2d | Level: %2d%n", attempts, accessLevel',
        inputs: [
          { type: 'format-string', expected: '%2d | Level: %2d%n' },
          { type: 'variable', expected: 'attempts' },
          { type: 'variable', expected: 'accessLevel' },
        ],
        explanation: '%2d right-aligns integers in 2 character field, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Display timestamp with 2 decimal precision',
        skeleton: 'System.out.printf("Timestamp: %.2f seconds%n", timestamp);',
        answer: '%.2f seconds%n", timestamp',
        inputs: [
          { type: 'format-string', expected: '%.2f seconds%n' },
          { type: 'variable', expected: 'timestamp' },
        ],
        explanation: '%.2f shows decimal numbers with 2 places, %n for newline',
      },
    ],
    expectedOutput: 'admin           | Attempting access\nFailed:  3 | Level:  9\nTimestamp: 1621.85 seconds\n',
    hints: [
      'Use %-20s to left-align strings',
      'Use %5d to right-align numbers in 5 character width',
      'Order of arguments must match order of format specifiers',
    ],
    gridWidth: 40,
    gridHeight: 4,
  },
  {
    id: 'restaurant-menu-intermediate',
    title: 'Restaurant Menu - Aligned Columns',
    difficulty: 'intermediate',
    theme: 'restaurant-menu',
    scenario: 'Create a restaurant menu with aligned columns for dish names and prices. Format creates clean columnar layout.',
    variables: [
      { name: 'item1', type: 'String', value: '"Lasagna"' },
      { name: 'price1', type: 'double', value: '14.99' },
      { name: 'item2', type: 'String', value: '"Risotto"' },
      { name: 'price2', type: 'double', value: '13.50' },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Format menu row 1 with left-aligned dish name (20 chars) and price',
        skeleton: 'String row1 = String.format("%-20s $%6.2f", item1, price1);',
        answer: '%-20s $%6.2f", item1, price1',
        inputs: [
          { type: 'format-string', expected: '%-20s $%6.2f' },
          { type: 'variable', expected: 'item1' },
          { type: 'variable', expected: 'price1' },
        ],
        explanation: '%-20s left-aligns string in 20 character field, %6.2f right-aligns price',
      },
      {
        method: 'format',
        prompt: 'Format menu row 2 with same alignment',
        skeleton: 'String row2 = String.format("%-20s $%6.2f", item2, price2);',
        answer: '%-20s $%6.2f", item2, price2',
        inputs: [
          { type: 'format-string', expected: '%-20s $%6.2f' },
          { type: 'variable', expected: 'item2' },
          { type: 'variable', expected: 'price2' },
        ],
        explanation: 'Same format ensures columns align vertically',
      },
    ],
    expectedOutput: 'Lasagna              $  14.99\nRisotto              $  13.50\n',
    hints: [
      'Use %-20s to left-align text in a 20-character field',
      'Use %6.2f to right-align numbers with 6 total width and 2 decimals',
      'Consistent widths create clean columnar alignment',
    ],
    gridWidth: 35,
    gridHeight: 3,
  },
  {
    id: 'battle-display-intermediate',
    title: 'Battle Status Display - RPG Stats',
    difficulty: 'intermediate',
    theme: 'battle-display',
    scenario: 'Create an RPG battle status display with right-aligned stat columns. Each line shows different combatant stats.',
    variables: [
      { name: 'name1', type: 'String', value: '"Knight"' },
      { name: 'hp1', type: 'int', value: '85' },
      { name: 'damage1', type: 'int', value: '12' },
      { name: 'name2', type: 'String', value: '"Wizard"' },
      { name: 'hp2', type: 'int', value: '42' },
      { name: 'damage2', type: 'int', value: '18' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display first combatant with right-aligned stats',
        skeleton: 'System.out.printf("%-10s HP: %3d  DMG: %3d%n", name1, hp1, damage1);',
        answer: '%-10s HP: %3d  DMG: %3d%n", name1, hp1, damage1',
        inputs: [
          { type: 'format-string', expected: '%-10s HP: %3d  DMG: %3d%n' },
          { type: 'variable', expected: 'name1' },
          { type: 'variable', expected: 'hp1' },
          { type: 'variable', expected: 'damage1' },
        ],
        explanation: '%-10s left-aligns name, %3d right-aligns numbers, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Display second combatant with same format',
        skeleton: 'System.out.printf("%-10s HP: %3d  DMG: %3d%n", name2, hp2, damage2);',
        answer: '%-10s HP: %3d  DMG: %3d%n", name2, hp2, damage2',
        inputs: [
          { type: 'format-string', expected: '%-10s HP: %3d  DMG: %3d%n' },
          { type: 'variable', expected: 'name2' },
          { type: 'variable', expected: 'hp2' },
          { type: 'variable', expected: 'damage2' },
        ],
        explanation: 'Identical format ensures columns align, %n for newline',
      },
    ],
    expectedOutput: 'Knight     HP:  85  DMG:  12\nWizard     HP:  42  DMG:  18\n',
    hints: [
      'Use %3d to right-align numbers in 3-character field',
      'Numbers are right-aligned by default when you specify width',
      'Consistent formatting creates organized columnar data',
    ],
    gridWidth: 35,
    gridHeight: 3,
  },
  {
    id: 'wanted-poster-advanced',
    title: 'Professional Wanted Poster - Full Details',
    difficulty: 'advanced',
    theme: 'wanted-poster',
    scenario: 'Create a professional wanted poster with full details including reward with thousands separator and precise measurements.',
    variables: [
      { name: 'name', type: 'String', value: '"Dr. Devious"' },
      { name: 'height', type: 'double', value: '5.92' },
      { name: 'weight', type: 'int', value: '187' },
      { name: 'reward', type: 'int', value: '500000' },
      { name: 'successRate', type: 'double', value: '94.5' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display "=== WANTED POSTER ===" header',
        skeleton: 'System.out.printf("%n=== WANTED POSTER ===%n");',
        answer: '%n=== WANTED POSTER ===%n',
        explanation: '%n is platform-independent newline (preferred over \\n)',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Display criminal name and measurements',
        skeleton: 'System.out.printf("Name: %-20s Height: %.2f ft  Weight: %4d lbs%n", name, height, weight);',
        answer: '%-20s Height: %.2f ft  Weight: %4d lbs%n", name, height, weight',
        explanation: 'Combine left-aligned string with right-aligned numbers, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Display reward with thousands separator',
        skeleton: 'System.out.printf("Reward: $%,d%n", reward);',
        answer: '$%,d%n", reward',
        explanation: '%,d adds thousands separators (500,000)',
      },
      {
        method: 'printf',
        prompt: 'Line 4: Display success rate percentage with borders',
        skeleton: 'System.out.printf("Success Rate: %6.1f%%%n", successRate);',
        answer: '%6.1f%%%n", successRate',
        explanation: '%% escapes percent, %6.1f right-aligns decimal',
      },
    ],
    expectedOutput: '\n=== WANTED POSTER ===\nName: Dr. Devious        Height: 5.92 ft  Weight:  187 lbs\nReward: $500,000\nSuccess Rate:  94.5%\n',
    hints: [
      'Use %,d to add thousands separators to integers',
      'Use %6.1f for right-aligned decimal with 1 decimal place',
      'Use %% to print a literal percent sign',
      'Use %n for cross-platform newlines',
    ],
    gridWidth: 50,
    gridHeight: 5,
  },
  {
    id: 'restaurant-menu-advanced',
    title: 'Restaurant Invoice - Detailed Calculation',
    difficulty: 'advanced',
    theme: 'restaurant-menu',
    scenario: 'Create a detailed restaurant invoice with subtotal, tax, and total. Uses width specifiers, decimal precision, and right-alignment.',
    variables: [
      { name: 'subtotal', type: 'double', value: '127.50' },
      { name: 'taxRate', type: 'double', value: '0.08' },
      { name: 'itemCount', type: 'int', value: '8' },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Show subtotal right-aligned with 2 decimal places in 10-char width',
        skeleton: 'String line1 = String.format("Subtotal: %10.2f", subtotal);',
        answer: '%10.2f", subtotal',
        explanation: '%10.2f allocates 10 characters total, right-aligned, 2 decimals',
      },
      {
        method: 'format',
        prompt: 'Line 2: Show calculated tax (8%%) on separate line',
        skeleton: 'String line2 = String.format("Tax (8%%): %10.2f", subtotal * taxRate);',
        answer: '%10.2f", subtotal * taxRate',
        explanation: '%% escapes the percent sign in format string',
      },
      {
        method: 'format',
        prompt: 'Line 3: Show item count padded with leading zeros to 3 digits',
        skeleton: 'String line3 = String.format("Items: %03d", itemCount);',
        answer: '%03d", itemCount',
        explanation: '%03d pads with leading zeros to 3 digits total',
      },
    ],
    expectedOutput: 'Subtotal:    127.50\nTax (8%):     10.20\nItems: 008\n',
    hints: [
      'Use %10.2f for total width of 10 with 2 decimal places',
      'Use %03d to pad numbers with leading zeros',
      'The 0 flag pads with zeros instead of spaces',
    ],
    gridWidth: 25,
    gridHeight: 4,
  },
  {
    id: 'diagnostic-panel-advanced',
    title: 'Diagnostic Panel - System Readout',
    difficulty: 'advanced',
    theme: 'diagnostic-panel',
    scenario: 'Create a detailed system diagnostic panel with memory stats, percentages, and system codes in hexadecimal.',
    variables: [
      { name: 'mission', type: 'String', value: '"Arctic Storm"' },
      { name: 'duration', type: 'int', value: '142' },
      { name: 'successRate', type: 'double', value: '98.7' },
      { name: 'errorCode', type: 'int', value: '255' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display mission name left-aligned in 20 chars with status',
        skeleton: 'System.out.printf("%-20s STATUS: COMPLETE%n", mission);',
        answer: '%-20s STATUS: COMPLETE%n", mission',
        explanation: '%-20s left-aligns in 20 character field, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Show duration in minutes and success percentage',
        skeleton: 'System.out.printf("Duration: %4d min | Success: %6.1f%%%n", duration, successRate);',
        answer: '%4d min | Success: %6.1f%%%n", duration, successRate',
        explanation: 'Combine multiple formats with careful spacing, %n for newline',
      },
      {
        method: 'format',
        prompt: 'Line 3: Convert error code to uppercase hexadecimal',
        skeleton: 'String hexCode = String.format("Code: %04X", errorCode);',
        answer: '%04X", errorCode',
        explanation: '%X displays integer as hexadecimal (uppercase), 04 pads to 4 digits',
      },
    ],
    expectedOutput: 'Arctic Storm        STATUS: COMPLETE\nDuration:  142 min | Success:  98.7%\nCode: 00FF\n',
    hints: [
      'Use %X for uppercase hexadecimal representation',
      'Use %x for lowercase hexadecimal',
      '%04X pads hexadecimal with leading zeros to 4 digits',
      'Use %6.1f for width 6 with 1 decimal precision',
    ],
    gridWidth: 45,
    gridHeight: 4,
  },
];

function getRandomChallenge(theme = null, difficulty = null) {
  let challenges = PRESET_CHALLENGES;

  if (theme) {
    challenges = challenges.filter((c) => c.theme === theme);
  }

  if (difficulty) {
    challenges = challenges.filter((c) => c.difficulty === difficulty);
  }

  if (challenges.length === 0) {
    return PRESET_CHALLENGES[0];
  }

  return challenges[Math.floor(Math.random() * challenges.length)];
}

/**
 * JavaFormatPractice - Student view for practicing Java printf and String.format
 * 
 * Hint System:
 * - Text Hint (💡): Shows explanation for the format specifier
 * - Using a hint will mark the current answer as "with hint" and prevent streak counting
 * - This encourages students to try without help first, but allows learning when stuck
 * 
 * Stats Tracking:
 * - Total: All attempts (with or without hints)
 * - Correct: Only correct answers WITHOUT any hints
 * - Streak: Consecutive correct answers WITHOUT any hints
 * - Longest Streak: Best streak achieved during the session
 */
export default function JavaFormatPractice({ sessionData }) {
  const sessionId = sessionData?.sessionId;
  const isSoloSession = sessionId ? sessionId.startsWith('solo-') : false;
  const initializedRef = useRef(false);
  const studentIdRef = useRef(null);
  const navigate = useNavigate();

  // Get session-ended handler
  const attachSessionEndedHandler = useSessionEndedHandler();

  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState(null);
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [currentFormatCallIndex, setCurrentFormatCallIndex] = useState(0);
  const [selectedDifficulty, setSelectedDifficulty] = useState('beginner');
  const [selectedTheme, setSelectedTheme] = useState('all');
  const [userAnswers, setUserAnswers] = useState([]);
  const [solvedAnswers, setSolvedAnswers] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [hintShown, setHintShown] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    correct: 0,
    streak: 0,
    longestStreak: 0,
  });
  const [focusToken, setFocusToken] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const splitAnswerParts = useCallback((answer = '') => answer.split(',').map((part) => part.trim()), []);

  const buildAnswerString = useCallback((parts = []) => {
    return parts.map((p) => p.trim()).join(', ');
  }, []);

  const createEmptyAnswers = useCallback(
    (formatCalls = []) => formatCalls.map((call) => new Array(splitAnswerParts(call.answer).length).fill('')),
    [splitAnswerParts]
  );

  // Helper to reset challenge state
  const resetChallengeState = useCallback(
    (formatCalls = []) => {
      setUserAnswers(createEmptyAnswers(formatCalls));
      setSolvedAnswers(Array.from({ length: formatCalls.length }, () => ''));
      setFeedback(null);
      setHintShown(false);
    },
    [createEmptyAnswers]
  );

  // Initialize student name for non-solo sessions
  useEffect(() => {
    if (isSoloSession) {
      setStudentName('Solo Student');
      setNameSubmitted(true);
      return;
    }

    const savedName = localStorage.getItem(`student-name-${sessionId}`);
    const savedId = localStorage.getItem(`student-id-${sessionId}`);
    if (savedName) {
      setStudentName(savedName);
      setStudentId(savedId);
      setNameSubmitted(true);
    }
  }, [sessionId, isSoloSession]);

  useEffect(() => {
    studentIdRef.current = studentId;
  }, [studentId]);

  useEffect(() => {
    if (!currentChallenge || !currentChallenge.formatCalls) return;
    resetChallengeState(currentChallenge.formatCalls);
    setCurrentFormatCallIndex(0);
  }, [currentChallenge, resetChallengeState]);

  // Load stats from localStorage
  useEffect(() => {
    if (!nameSubmitted || !sessionId) return;

    const key = `format-stats-${sessionId}-${studentId}`;
    const savedStats = localStorage.getItem(key);
    if (savedStats) {
      try {
        setStats(JSON.parse(savedStats));
      } catch (err) {
        console.error('Failed to parse saved stats:', err);
      }
    }
  }, [nameSubmitted, sessionId, studentId]);

  // Generate first challenge
  useEffect(() => {
    if (!nameSubmitted) return;

    if (currentChallenge === null) {
      const challenge = getRandomChallenge(
        selectedTheme === 'all' ? null : selectedTheme,
        selectedDifficulty
      );
      setCurrentChallenge(challenge);
      setCurrentFormatCallIndex(0);
      resetChallengeState(challenge.formatCalls || []);
      setFocusToken((t) => t + 1);
    }
  }, [nameSubmitted, selectedDifficulty, selectedTheme]);

  const handleWsMessage = useCallback(
    (event) => {
      console.log('WebSocket message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        console.log('Parsed message:', message);
        if (message.type === 'session-ended') {
          navigate('/session-ended');
          return;
        }
        if (message.type === 'studentId') {
          const newStudentId = message.payload.studentId;
          setStudentId(newStudentId);
          localStorage.setItem(`student-id-${sessionId}`, newStudentId);
          console.log('Received student ID:', newStudentId);
        } else if (message.type === 'difficultyUpdate') {
          const difficulty = message.payload.difficulty || 'beginner';
          console.log('Updating difficulty to:', difficulty);
          setSelectedDifficulty(difficulty);
          const challenge = getRandomChallenge(
            selectedTheme === 'all' ? null : selectedTheme,
            difficulty
          );
          setCurrentChallenge(challenge);
        } else if (message.type === 'themeUpdate') {
          const theme = message.payload.theme || 'all';
          console.log('Updating theme to:', theme);
          setSelectedTheme(theme);
          const challenge = getRandomChallenge(
            theme === 'all' ? null : theme,
            selectedDifficulty
          );
          setCurrentChallenge(challenge);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    },
    [navigate, resetChallengeState, sessionId, selectedTheme, selectedDifficulty]
  );

  const handleWsOpen = useCallback(() => {
    console.log('WebSocket connected for session:', sessionId);
  }, [sessionId]);

  const buildWsUrl = useCallback(() => {
    if (!nameSubmitted || isSoloSession) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const currentId = studentIdRef.current;
    const studentIdParam = currentId ? `&studentId=${encodeURIComponent(currentId)}` : '';
    return `${protocol}//${host}/ws/java-format-practice?sessionId=${sessionId}&studentName=${encodeURIComponent(
      studentName
    )}${studentIdParam}`;
  }, [nameSubmitted, isSoloSession, sessionId, studentName]);

  const { connect: connectStudentWs, disconnect: disconnectStudentWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(nameSubmitted && !isSoloSession),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: null,
    onClose: null,
    attachSessionEndedHandler,
  });

  useEffect(() => {
    if (!nameSubmitted || isSoloSession) {
      disconnectStudentWs();
      return undefined;
    }
    connectStudentWs();
    return () => {
      disconnectStudentWs();
    };
  }, [nameSubmitted, sessionId, isSoloSession, connectStudentWs, disconnectStudentWs]);

  // Save stats to localStorage when they change
  useEffect(() => {
    if (!sessionId || !studentId) return;

    const key = `format-stats-${sessionId}-${studentId}`;
    localStorage.setItem(key, JSON.stringify(stats));

    // Sync to server if in class mode
    if (!isSoloSession) {
      fetch(`/api/java-format-practice/${sessionId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          stats,
        }),
      }).catch((err) => console.error('Failed to sync stats:', err));
    }
  }, [stats, sessionId, studentId, isSoloSession]);

  const getCurrentFormatCall = () => {
    if (!currentChallenge || !currentChallenge.formatCalls) return null;
    return currentChallenge.formatCalls[currentFormatCallIndex];
  };

  const handleNameSubmit = (name) => {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }

    setStudentName(name);
    localStorage.setItem(`student-name-${sessionId}`, name);

    // Generate a student ID
    const id = `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setStudentId(id);
    localStorage.setItem(`student-id-${sessionId}`, id);

    setNameSubmitted(true);
  };

  const checkAnswer = () => {
    if (!currentChallenge || !currentChallenge.formatCalls) return;

    const calls = currentChallenge.formatCalls;

    if (selectedDifficulty === 'beginner') {
      setHasSubmitted(true);
      if (typeof window !== 'undefined') window.hasSubmitted = true;
      const formatCall = calls[currentFormatCallIndex];
      const userParts = userAnswers[currentFormatCallIndex] || [];
      const expectedParts = splitAnswerParts(formatCall.answer);
      
      // Adjust expected parts for string literals in beginner mode
      const inputsMeta = formatCall.inputs || [];
      const adjustedExpectedParts = expectedParts.map((part, idx) => {
        const meta = inputsMeta[idx];
        if (meta?.type === 'string-literal') {
          // User should NOT type quotes, so add them back for comparison
          return `"${part}"`;
        }
        // Format strings and variables don't get quotes
        return part;
      });
      
      // Adjust user parts similarly
      const adjustedUserParts = userParts.map((part, idx) => {
        const meta = inputsMeta[idx];
        if (meta?.type === 'string-literal') {
          // User typed without quotes, add them for comparison
          return `"${part.trim()}"`;
        }
        // Format strings and variables don't get quotes
        return part.trim();
      });

      const submitted = adjustedUserParts.join(', ');
      const expected = adjustedExpectedParts.join(', ');
      const isCorrect = submitted === expected;

      // Provide detailed feedback about which part is wrong
      let detailedMessage = '';
      let wrongParts = [];
      if (!isCorrect && userParts.length === expectedParts.length) {
        userParts.forEach((part, idx) => {
          const meta = inputsMeta[idx];
          const partName = meta?.type === 'format-string' 
            ? 'format specifier'
            : meta?.type === 'string-literal'
            ? 'string literal'
            : 'variable';
          if (adjustedUserParts[idx] !== adjustedExpectedParts[idx]) {
            const { expected: expDiff, actual: actDiff } = highlightDiff(adjustedExpectedParts[idx], adjustedUserParts[idx] || '');
            wrongParts.push(`${partName} (expected: <code>${expDiff}</code>, got: <code>${actDiff}</code>)`);
          }
        });
        if (wrongParts.length > 0) {
          detailedMessage = `Incorrect ${wrongParts.join(', ')}`;
        }
      }

      console.log('Checking answer:', {
        submitted,
        expected,
        userAnswers: userParts,
        adjustedUserParts,
        adjustedExpectedParts,
        isCorrect,
        detailedMessage
      });

      if (isCorrect) {
        setSolvedAnswers((prev) => {
          const next = [...prev];
          next[currentFormatCallIndex] = formatCall.answer;
          return next;
        });
      }

      setStats((prev) => {
        const newStats = { ...prev };
        newStats.total += 1;

        if (isCorrect && !hintShown) {
          newStats.correct += 1;
          newStats.streak += 1;
          if (newStats.streak > newStats.longestStreak) {
            newStats.longestStreak = newStats.streak;
          }
        } else if (!isCorrect) {
          newStats.streak = 0;
        } else {
          newStats.streak = 0;
        }

        return newStats;
      });

      // Only show explanation for incorrect answers if the wrong part is a format specifier or string literal.
      let explanation = undefined;
      if (isCorrect) {
        explanation = formatCall.explanation;
      } else if (wrongParts.length > 0) {
        // Only show explanation if the wrong part is a format specifier or string literal
        const wrongTypes = userParts.map((part, idx) => adjustedUserParts[idx] !== adjustedExpectedParts[idx] ? (inputsMeta[idx]?.type) : null).filter(Boolean);
        if (wrongTypes.includes('format-string') || wrongTypes.includes('string-literal')) {
          explanation = formatCall.explanation;
        }
      }

      setFeedback({
        isCorrect,
        message: isCorrect
          ? `Correct! ${hintShown ? '(but you used a hint)' : ''}`
          : detailedMessage || 'Not quite. Try again.',
        explanation,
      });
    } else {
      // Intermediate/Advanced mode: validate all lines
      let allCorrect = true;
      let detailedFeedback = [];
      
      calls.forEach((call, idx) => {
        const userSubmitted = buildAnswerString(userAnswers[idx] || []);
        const expected = call.answer;
        
        if (userSubmitted !== expected) {
          allCorrect = false;
          const { expected: expDiff, actual: actDiff } = highlightDiff(expected, userSubmitted);
          const lineNum = idx + 1;
          detailedFeedback.push(`Line ${lineNum}: Expected <code>${expDiff}</code>, got <code>${actDiff}</code>`);
        }
      });

      setStats((prev) => {
        const newStats = { ...prev };
        newStats.total += 1;

        if (allCorrect && !hintShown) {
          newStats.correct += 1;
          newStats.streak += 1;
          if (newStats.streak > newStats.longestStreak) {
            newStats.longestStreak = newStats.streak;
          }
        } else if (!allCorrect) {
          newStats.streak = 0;
        } else {
          newStats.streak = 0;
        }

        return newStats;
      });

      setFeedback({
        isCorrect: allCorrect,
        message: allCorrect
          ? `All lines correct! ${hintShown ? '(but you used a hint)' : ''}`
          : detailedFeedback.length > 0
          ? detailedFeedback.join('<br/>')
          : 'Some lines are incorrect. Check your format specifiers and arguments.',
        explanation: allCorrect ? calls[0]?.explanation : undefined,
      });
    }
  };

  const handleHint = () => {
    setHintShown(true);
  };

  const handleNextChallenge = () => {
    if (!currentChallenge || !currentChallenge.formatCalls) return;

    // For beginner: move to next line within same challenge if available AND answer was correct
    if (selectedDifficulty === 'beginner' && currentFormatCallIndex < currentChallenge.formatCalls.length - 1 && feedback?.isCorrect) {
      // Fill the just-answered line with the expected answer so it shows as solved
      setSolvedAnswers((prev) => {
        const next = [...prev];
        next[currentFormatCallIndex] = currentChallenge.formatCalls[currentFormatCallIndex].answer;
        return next;
      });

      setCurrentFormatCallIndex((idx) => idx + 1);
      setFeedback(null);
      setHintShown(false);
      setHasSubmitted(false);
      setUserAnswers((prev) => {
        const next = [...prev];
        const nextParts = splitAnswerParts(currentChallenge.formatCalls[currentFormatCallIndex + 1]?.answer || '');
        next[currentFormatCallIndex + 1] = new Array(nextParts.length).fill('');
        return next;
      });
      setFocusToken((t) => t + 1);
      return;
    }

    // If beginner and on the last line AND correct, mark it solved before moving on
    if (selectedDifficulty === 'beginner' && currentFormatCallIndex >= currentChallenge.formatCalls.length - 1 && feedback?.isCorrect) {
      setSolvedAnswers((prev) => {
        const next = [...prev];
        next[currentFormatCallIndex] = currentChallenge.formatCalls[currentFormatCallIndex].answer;
        return next;
      });
    }

    const pickChallenge = () => {
      const theme = selectedTheme === 'all' ? null : selectedTheme;
      let next = getRandomChallenge(theme, selectedDifficulty);
      let attempts = 0;
      while (next && currentChallenge && next.id === currentChallenge.id && attempts < 5) {
        next = getRandomChallenge(theme, selectedDifficulty);
        attempts += 1;
      }
      return next;
    };

    const challenge = pickChallenge();
    setCurrentChallenge(challenge);
    setCurrentFormatCallIndex(0);
    setHasSubmitted(false);
    setFocusToken((t) => t + 1);
  };

  const handleDifficultyChange = (difficulty) => {
    setSelectedDifficulty(difficulty);
    if (!isSoloSession) {
      fetch(`/api/java-format-practice/${sessionId}/difficulty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      }).catch((err) => console.error('Failed to update difficulty:', err));
    }
    const challenge = getRandomChallenge(
      selectedTheme === 'all' ? null : selectedTheme,
      difficulty
    );
    setCurrentChallenge(challenge);
    setCurrentFormatCallIndex(0);
    setFocusToken((t) => t + 1);
  };

  const handleThemeChange = (theme) => {
    setSelectedTheme(theme);
    if (!isSoloSession) {
      fetch(`/api/java-format-practice/${sessionId}/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      }).catch((err) => console.error('Failed to update theme:', err));
    }
    const challenge = getRandomChallenge(
      theme === 'all' ? null : theme,
      selectedDifficulty
    );
    setCurrentChallenge(challenge);
    setCurrentFormatCallIndex(0);
    setFocusToken((t) => t + 1);
  };

  // Show name prompt if not in solo mode and name not submitted
  if (!isSoloSession && !nameSubmitted) {
    return (
      <div className="name-prompt-overlay">
        <div className="name-prompt-dialog">
          <h2>Welcome to Java Format Practice</h2>
          <p>Please enter your name to continue:</p>
          <input
            type="text"
            className="name-input"
            placeholder="Your name"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleNameSubmit(e.target.value);
              }
            }}
            autoFocus
          />
          <button
            className="name-submit-btn"
            onClick={(e) => {
              const input = e.target.parentElement.querySelector('.name-input');
              handleNameSubmit(input.value);
            }}
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  if (!currentChallenge || !getCurrentFormatCall()) {
    return <div>Loading challenge...</div>;
  }

  const formatCall = getCurrentFormatCall();
  const progressText = `${currentFormatCallIndex + 1}/${currentChallenge.formatCalls.length}`;
  const hasInput = (() => {
    if (selectedDifficulty === 'beginner') {
      const parts = userAnswers[currentFormatCallIndex] || [];
      const expected = splitAnswerParts(formatCall.answer).length;
      return parts.length === expected && parts.every((p) => p.trim());
    }
    const calls = currentChallenge.formatCalls || [];
    return calls.every((call, idx) => {
      const parts = userAnswers[idx] || [];
      const expected = splitAnswerParts(call.answer).length;
      return parts.length === expected && parts.every((p) => p.trim());
    });
  })();
  const submitDisabled = !hasInput;

  return (
    <div className="java-format-container">
      <div className="java-format-header">
        <div className="format-title">Format Practice</div>
        <div className="format-subtitle">
          {currentChallenge.theme} - {progressText}
        </div>
      </div>

      <div className="java-format-content">
        <ChallengeSelector
          currentDifficulty={selectedDifficulty}
          currentTheme={selectedTheme}
          onDifficultyChange={handleDifficultyChange}
          onThemeChange={handleThemeChange}
          isDisabled={feedback?.isCorrect === true}
        />

        <div className="challenge-card">
          <div className="challenge-header">
            <div className="theme-title">{currentChallenge.title}</div>
            <span
              className={`difficulty-badge ${currentChallenge.difficulty}`}
            >
              {currentChallenge.difficulty}
            </span>
          </div>

          <p className="scenario-text">{currentChallenge.scenario}</p>

          {currentChallenge.expectedOutput && (
            <>
              <h4>Expected Output:</h4>
              <CharacterGrid
                text={currentChallenge.expectedOutput}
                width={currentChallenge.gridWidth || 30}
                height={currentChallenge.gridHeight || 3}
                showRows={false}
              />
            </>
          )}

          <AnswerSection
            formatCalls={currentChallenge.formatCalls}
            variables={currentChallenge.variables}
            difficulty={selectedDifficulty}
            currentIndex={currentFormatCallIndex}
            userAnswers={userAnswers}
            solvedAnswers={solvedAnswers}
            onAnswerChange={(updater) => {
              setUserAnswers(updater);
              if (hasSubmitted && !feedback?.isCorrect) {
                setFeedback(null);
                setHasSubmitted(false);
              }
            }}
            onSubmit={checkAnswer}
            isDisabled={feedback?.isCorrect === true}
            submitDisabled={submitDisabled}
            hintShown={hintShown}
            onHint={handleHint}
            focusToken={focusToken}
          />

          <FeedbackDisplay
            feedback={feedback}
            onNewChallenge={handleNextChallenge}
            showNextButton={selectedDifficulty === 'beginner' ? feedback?.isCorrect : !!feedback}
          />
        </div>

        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}
