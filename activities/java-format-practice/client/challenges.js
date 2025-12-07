// Dynamic challenge generator for Java format practice
// Provides variable name options, value variability, and per-character masks

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

// Format with a parallel mask: 'S' = static literal, 'V' = value/width-driven
function formatWithMask(formatStr, args = []) {
  if (!formatStr) return { text: '', mask: '' };
  let result = '';
  let mask = '';
  let argIndex = 0;
  let i = 0;

  while (i < formatStr.length) {
    if (formatStr[i] === '%' && i + 1 < formatStr.length) {
      const next = formatStr[i + 1];

      if (next === '%') {
        result += '%';
        mask += 'S';
        i += 2;
        continue;
      }

      if (next === 'n') {
        result += '\n';
        mask += 'S';
        i += 2;
        continue;
      }

      let j = i + 1;
      let spec = '';
      while (j < formatStr.length && !'sdfxX'.includes(formatStr[j])) {
        spec += formatStr[j];
        j++;
      }

      const type = formatStr[j];
      if (!type) {
        result += formatStr[i];
        mask += 'S';
        i++;
        continue;
      }

      // Parse flags more carefully - zero-pad flag is '0' at the START of spec, not in the width
      const flags = {
        leftAlign: spec.includes('-'),
        zeroPad: /^0/.test(spec) && !/^-/.test(spec),  // Zero-pad only if 0 is first (not after -)
        grouping: spec.includes(','),
      };

      const widthMatch = spec.match(/(-|0|,)?(\d+)/);
      const width = widthMatch ? parseInt(widthMatch[2], 10) : undefined;
      const precisionMatch = spec.match(/\.(\d+)/);
      const precision = precisionMatch ? parseInt(precisionMatch[1], 10) : undefined;

      const value = args[argIndex++];
      let formatted = '';

      if (type === 's') {
        formatted = String(value ?? '');
        formatted = padValue(formatted, width, flags.leftAlign, flags.zeroPad ? '0' : ' ');
      } else if (type === 'd') {
        let num = parseInt(value ?? 0, 10) || 0;
        if (flags.grouping) {
          formatted = num.toLocaleString('en-US');
        } else {
          formatted = String(num);
        }
        formatted = padValue(formatted, width, flags.leftAlign, flags.zeroPad ? '0' : ' ');
      } else if (type === 'f') {
        const num = parseFloat(value ?? 0) || 0;
        formatted = formatNumber(num, precision ?? 6);
        formatted = padValue(formatted, width, flags.leftAlign, flags.zeroPad ? '0' : ' ');
      } else if (type === 'x' || type === 'X') {
        const num = parseInt(value ?? 0, 10) || 0;
        formatted = num.toString(16);
        if (type === 'X') formatted = formatted.toUpperCase();
        formatted = padValue(formatted, width, flags.leftAlign, flags.zeroPad ? '0' : ' ');
      } else {
        formatted = String(value ?? '');
      }

      result += formatted;
      mask += 'V'.repeat(formatted.length);
      i = j + 1;
    } else {
      result += formatStr[i];
      mask += 'S';
      i++;
    }
  }

  return { text: result, mask };
}

function evaluateArgs(expressions, valueMap) {
  return expressions.map((expr) => {
    const trimmed = expr.trim();
    if (!trimmed) return '';
    const keys = Object.keys(valueMap);
    const vals = Object.values(valueMap);
    try {
      // Replace Java type casts with JavaScript equivalents
      let jsExpr = trimmed;
      
      // Handle (int)expression or (int)(expression) patterns
      // Replace (int) followed by optional whitespace
      jsExpr = jsExpr.replace(/\(int\)\s*/g, 'Math.trunc(');
      jsExpr = jsExpr.replace(/\(long\)\s*/g, 'Math.trunc(');
      
      // (float) and (double) can just be removed since JS doesn't distinguish
      jsExpr = jsExpr.replace(/\(float\)\s*/g, '');
      jsExpr = jsExpr.replace(/\(double\)\s*/g, '');
      
      // Count Math.trunc( calls and make sure they're properly closed
      const truncCalls = (jsExpr.match(/Math\.trunc\(/g) || []).length;
      const closingParens = (jsExpr.match(/\)/g) || []).length;
      
      // If we have more Math.trunc calls than closing parens relative to opening parens in the original,
      // we need to add closing parens for the Math.trunc wrappers
      if (truncCalls > 0) {
        // Each Math.trunc( needs a closing paren
        jsExpr = jsExpr + ')'.repeat(truncCalls);
      }
      
      // eslint-disable-next-line no-new-func
      return new Function(...keys, `return ${jsExpr};`)(...vals);
    } catch (err) {
      console.warn('Failed to evaluate expression', trimmed, err);
      return '';
    }
  });
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
        chosenValue = randomFloat(min, max, precision ?? 2);
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

  formatCalls.forEach((call) => {
    const answerStr = call.answer || '';
    if (!answerStr.trim()) return;
    
    // Parse answer more carefully to handle format specifiers with commas (e.g., %,d)
    let formatString = '';
    let argExprs = [];
    
    // Check if format string is quoted (advanced mode)
    if (answerStr.trim().startsWith('"')) {
      // Find the closing quote
      const closeQuoteIdx = answerStr.indexOf('"', 1);
      if (closeQuoteIdx !== -1) {
        formatString = answerStr.slice(1, closeQuoteIdx);
        // Everything after the closing quote and comma
        const rest = answerStr.slice(closeQuoteIdx + 1).trim();
        if (rest.startsWith(',')) {
          argExprs = rest.slice(1).split(',').map(p => p.trim()).filter(Boolean);
        }
      }
    } else {
      // Unquoted format string (beginner/intermediate mode)
      // Find the first ", " (comma-space) which separates format string from arguments
      // This preserves commas within format specifiers like %,d
      const separatorIdx = answerStr.indexOf(', ');
      if (separatorIdx !== -1) {
        formatString = answerStr.slice(0, separatorIdx).trim();
        const rest = answerStr.slice(separatorIdx + 1).trim();
        argExprs = rest.split(',').map(p => p.trim()).filter(Boolean);
      } else {
        // No arguments, just format string
        formatString = answerStr.trim();
      }
    }
    
    const argValues = evaluateArgs(argExprs, valueMap);
    const { text, mask } = formatWithMask(formatString, argValues);
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

const CHALLENGE_DEFINITIONS = [
  // ===== WANTED-POSTER THEME =====
  {
    id: 'wanted-poster-dynamic-beginner',
    title: 'Wanted Poster Shuffle',
    difficulty: 'beginner',
    theme: 'wanted-poster',
    scenario: 'Print a changing wanted poster where the suspect, crime, and reward values shuffle each round.',
    gridWidth: 32,
    gridHeight: 6,
    variableTemplates: [
      {
        key: 'suspectName',
        type: 'String',
        names: ['suspect', 'target', 'alias', 'bandit'],
        values: ['Shadow Fox', 'Red Raven', 'Midnight Jack', 'Night Sparrow'],
      },
      {
        key: 'crimeName',
        type: 'String',
        names: ['crime', 'offense', 'charge'],
        values: ['Train Heist', 'Museum Job', 'Bank Job', 'Data Breach'],
      },
      {
        key: 'bounty',
        type: 'int',
        names: ['reward', 'bounty', 'purse'],
        range: { min: 3000, max: 12000, step: 500 },
      },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Print the poster header',
        skeleton: 'System.out.printf("=== WANTED ===%n");',
        answer: '=== WANTED ===%n',
        inputs: [
          { type: 'constant-string', expected: '=== WANTED ===%n' },
        ],
        explanation: 'Header uses a constant string; %n adds a newline.',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Show the suspect name',
        skeleton: 'System.out.printf("Name: %s%n", {{suspectName}});',
        answer: 'Name: %s%n, {{suspectName}}',
        inputs: [
          { type: 'format-string', expected: 'Name: %s%n' },
          { type: 'variable', expected: '{{suspectName}}' },
        ],
        explanation: 'Use %s for the changing suspect name; %n for newline.',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Show the crime',
        skeleton: 'System.out.printf("Crime: %s%n", {{crimeName}});',
        answer: 'Crime: %s%n, {{crimeName}}',
        inputs: [
          { type: 'format-string', expected: 'Crime: %s%n' },
          { type: 'variable', expected: '{{crimeName}}' },
        ],
        explanation: 'Use %s for the rotating crime description; %n for newline.',
      },
      {
        method: 'printf',
        prompt: 'Line 4: Show the bounty',
        skeleton: 'System.out.printf("Reward: $%d%n", {{bounty}});',
        answer: 'Reward: $%d%n, {{bounty}}',
        inputs: [
          { type: 'format-string', expected: 'Reward: $%d%n' },
          { type: 'variable', expected: '{{bounty}}' },
        ],
        explanation: 'Use %d for the integer bounty; %n for newline.',
      },
    ],
  },
  {
    id: 'fantasy-menu-dynamic-intermediate',
    title: 'Fantasy Tavern Menu',
    difficulty: 'intermediate',
    theme: 'fantasy-menu',
    scenario: 'Build a tavern menu with aligned columns where dish names and prices shuffle.',
    gridWidth: 38,
    gridHeight: 4,
    variableTemplates: [
      {
        key: 'dish1',
        type: 'String',
        names: ['starter', 'firstDish', 'special1'],
        values: ['Dragon Stew', 'Elf Bread', 'Goblin Skewers', 'Phoenix Omelette'],
      },
      {
        key: 'price1',
        type: 'double',
        names: ['priceA', 'costA'],
        range: { min: 8.5, max: 18.5, precision: 2 },
      },
      {
        key: 'dish2',
        type: 'String',
        names: ['entree', 'secondDish', 'special2'],
        values: ['Mermaid Sushi', 'Dwarf Pie', 'Hydra Burger', 'Griffin Roast'],
      },
      {
        key: 'price2',
        type: 'double',
        names: ['priceB', 'costB'],
        range: { min: 9.0, max: 21.0, precision: 2 },
      },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Left-align dish name (16 chars) and right-align price',
        skeleton: 'String row1 = String.format("%-16s | %6.2f", {{dish1}}, {{price1}});',
        answer: '%-16s | %6.2f, {{dish1}}, {{price1}}',
        inputs: [
          { type: 'format-string', expected: '%-16s | %6.2f' },
          { type: 'variable', expected: '{{dish1}}' },
          { type: 'variable', expected: '{{price1}}' },
        ],
        explanation: '%-16s left-aligns dish in 16 chars; %6.2f right-aligns price.',
      },
      {
        method: 'format',
        prompt: 'Line 2: Repeat alignment for the second dish',
        skeleton: 'String row2 = String.format("%-16s | %6.2f", {{dish2}}, {{price2}});',
        answer: '%-16s | %6.2f, {{dish2}}, {{price2}}',
        inputs: [
          { type: 'format-string', expected: '%-16s | %6.2f' },
          { type: 'variable', expected: '{{dish2}}' },
          { type: 'variable', expected: '{{price2}}' },
        ],
        explanation: 'Same widths keep columns aligned as values change.',
      },
    ],
  },
  {
    id: 'spy-badge-dynamic-advanced',
    title: 'Classified Mission Badge',
    difficulty: 'advanced',
    theme: 'spy-badge',
    scenario: 'Create a detailed mission badge with agent stats, mission scores, and calculated threat assessment.',
    gridWidth: 40,
    gridHeight: 7,
    variableTemplates: [
      {
        key: 'agent',
        type: 'String',
        names: ['agent', 'handle', 'codename'],
        values: ['Specter', 'Cipher', 'Ghostline', 'Nightshade'],
      },
      {
        key: 'completed',
        type: 'int',
        names: ['ops', 'missions', 'completed'],
        range: { min: 8, max: 25, step: 1 },
      },
      {
        key: 'failed',
        type: 'int',
        names: ['failures', 'lost'],
        range: { min: 0, max: 3, step: 1 },
      },
      {
        key: 'clearance',
        type: 'int',
        names: ['code', 'badgeCode', 'securityCode'],
        range: { min: 4096, max: 65535, step: 256 },
      },
      {
        key: 'baseScore',
        type: 'int',
        names: ['points', 'rating'],
        range: { min: 850, max: 990, step: 10 },
      },
      {
        key: 'threatBonus',
        type: 'double',
        names: ['modifier', 'multiplier'],
        values: [1.15, 1.20, 1.25, 1.30],
      },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Badge header with agent name, total width 34 chars',
        skeleton: 'String line1 = String.format("=== AGENT: %-19s ===%n", {{agent}});',
        answer: '"=== AGENT: %-19s ===%n", {{agent}}',
        inputs: [
          { type: 'format-string', expected: '"=== AGENT: %-19s ===%n", {{agent}}' },
        ],
        explanation: '"=== AGENT: " (11 chars) + %-19s + " ===" (4 chars) = 34 total.',
      },
      {
        method: 'format',
        prompt: 'Line 2: Mission counts with completed and failed, width 34 chars',
        skeleton: 'String line2 = String.format("Missions: %2d Completed | %2d Failed%n", {{completed}}, {{failed}});',
        answer: '"Missions: %2d Completed | %2d Failed%n", {{completed}}, {{failed}}',
        inputs: [
          { type: 'format-string', expected: '"Missions: %2d Completed | %2d Failed%n", {{completed}}, {{failed}}' },
        ],
        explanation: 'Format: "Missions: XX Completed | XX Failed" = 34 chars.',
      },
      {
        method: 'format',
        prompt: 'Line 3: Clearance code in uppercase hex (4 digits)',
        skeleton: 'String line3 = String.format("Security Clearance: %04X%n", {{clearance}});',
        answer: '"Security Clearance: %04X%n", {{clearance}}',
        inputs: [
          { type: 'format-string', expected: '"Security Clearance: %04X%n", {{clearance}}' },
        ],
        explanation: '%04X converts to uppercase hex, zero-padded to 4 digits.',
      },
      {
        method: 'format',
        prompt: 'Line 4: Base score - label left-justified, value right-justified at position 34',
        skeleton: 'String base = String.format("%-28s%6d", "Base Score:", {{baseScore}});',
        answer: '"%-28s%6d", "Base Score:", {{baseScore}}',
        inputs: [
          { type: 'format-string', expected: '"%-28s%6d", "Base Score:", {{baseScore}}' },
        ],
        explanation: '%-28s left-aligns label; %6d right-aligns value; total = 34 chars.',
      },
      {
        method: 'format',
        prompt: 'Line 5: Bonus - build label with percentage, same 34-char alignment',
        skeleton: 'String bonus = String.format("%-28s%6.0f", "Bonus (" + Math.round(({{threatBonus}} - 1) * 100) + "%):", {{baseScore}} * ({{threatBonus}} - 1));',
        answer: '"%-28s%6.0f", "Bonus (" + Math.round(({{threatBonus}} - 1) * 100) + "%):", {{baseScore}} * ({{threatBonus}} - 1)',
        inputs: [
          { type: 'format-string', expected: '"%-28s%6.0f", "Bonus (" + Math.round(({{threatBonus}} - 1) * 100) + "%):", {{baseScore}} * ({{threatBonus}} - 1)' },
        ],
        explanation: 'Build label with percentage; %-28s and %6.0f (rounds automatically) maintain 34-char width.',
      },
      {
        method: 'format',
        prompt: 'Line 6: Final assessment - same alignment pattern, 34 chars total',
        skeleton: 'String total = String.format("%-28s%6.0f", "FINAL ASSESSMENT:", {{baseScore}} * {{threatBonus}});',
        answer: '"%-28s%6.0f", "FINAL ASSESSMENT:", {{baseScore}} * {{threatBonus}}',
        inputs: [
          { type: 'format-string', expected: '"%-28s%6.0f", "FINAL ASSESSMENT:", {{baseScore}} * {{threatBonus}}' },
        ],
        explanation: 'Label left-justified in 28 chars, value right-justified in 6 chars (%.0f rounds) = 34 total.',
      },
    ],
  },
  // ===== WANTED-POSTER INTERMEDIATE =====
  {
    id: 'wanted-poster-intermediate',
    title: 'Professional Wanted Poster',
    difficulty: 'intermediate',
    theme: 'wanted-poster',
    scenario: 'Format a wanted poster with aligned columns for suspect info and reward.',
    gridWidth: 40,
    gridHeight: 4,
    variableTemplates: [
      {
        key: 'name',
        type: 'String',
        names: ['suspect', 'target'],
        values: ['Dr. Chaos', 'The Phantom', 'Agent Smith', 'Rogue Element'],
      },
      {
        key: 'bounty',
        type: 'int',
        names: ['reward', 'payment'],
        range: { min: 50000, max: 500000, step: 50000 },
      },
      {
        key: 'danger',
        type: 'int',
        names: ['level', 'rating'],
        range: { min: 1, max: 10, step: 1 },
      },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Format suspect name left-aligned in 15 chars',
        skeleton: 'String line1 = String.format("%-15s Danger: %2d", {{name}}, {{danger}});',
        answer: '%-15s Danger: %2d, {{name}}, {{danger}}',
        inputs: [
          { type: 'format-string', expected: '%-15s Danger: %2d' },
          { type: 'variable', expected: '{{name}}' },
          { type: 'variable', expected: '{{danger}}' },
        ],
        explanation: '%-15s left-aligns name; %2d right-aligns danger level.',
      },
      {
        method: 'format',
        prompt: 'Line 2: Format reward with thousands separator',
        skeleton: 'String line2 = String.format("Reward: $%,d", {{bounty}});',
        answer: 'Reward: $%,d, {{bounty}}',
        inputs: [
          { type: 'format-string', expected: 'Reward: $%,d' },
          { type: 'variable', expected: '{{bounty}}' },
        ],
        explanation: '%,d adds comma separators for thousands.',
      },
    ],
  },
  // ===== WANTED-POSTER ADVANCED =====
  {
    id: 'wanted-poster-advanced',
    title: 'Elite Wanted Database Entry',
    difficulty: 'advanced',
    theme: 'wanted-poster',
    scenario: 'Create a full wanted poster with suspect info, crimes, bounty, and calculated total reward.',
    gridWidth: 41,
    gridHeight: 6,
    variableTemplates: [
      {
        key: 'criminalName',
        type: 'String',
        names: ['fugitive', 'suspect'],
        values: ['Victor Frostbyte', 'Nyx Shadowborn', 'Krell the Unstable', 'Dr. Chaos'],
      },
      {
        key: 'caseNum',
        type: 'int',
        names: ['caseID', 'reference'],
        range: { min: 100, max: 9999, step: 1 },
      },
      {
        key: 'baseBounty',
        type: 'int',
        names: ['baseReward', 'initialBounty'],
        range: { min: 50000, max: 200000, step: 10000 },
      },
      {
        key: 'crimeCount',
        type: 'int',
        names: ['offenses', 'charges'],
        range: { min: 3, max: 12, step: 1 },
      },
      {
        key: 'dangerLevel',
        type: 'int',
        names: ['threat', 'riskLevel'],
        range: { min: 5, max: 10, step: 1 },
      },
      {
        key: 'bonusRate',
        type: 'double',
        names: ['multiplier', 'bonus'],
        values: [0.15, 0.20, 0.25, 0.30],
      },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Header with suspect name and case number, 40 chars total',
        skeleton: 'String line1 = String.format("SUSPECT: %-22s | #%05d", {{criminalName}}, {{caseNum}});',
        answer: '"SUSPECT: %-22s | #%05d", {{criminalName}}, {{caseNum}}',
        inputs: [
          { type: 'format-string', expected: '"SUSPECT: %-22s | #%05d", {{criminalName}}, {{caseNum}}' },
        ],
        explanation: '"SUSPECT: " (9) + %-22s + " | #" (4) + %05d (5) = 40 chars.',
      },
      {
        method: 'format',
        prompt: 'Line 2: Crime count and danger level, 40 chars total',
        skeleton: 'String line2 = String.format("Crimes: %2d               | Danger: %2d/10", {{crimeCount}}, {{dangerLevel}});',
        answer: '"Crimes: %2d               | Danger: %2d/10", {{crimeCount}}, {{dangerLevel}}',
        inputs: [
          { type: 'format-string', expected: '"Crimes: %2d               | Danger: %2d/10", {{crimeCount}}, {{dangerLevel}}' },
        ],
        explanation: '"Crimes: " + %2d (2) + 15 spaces + " | Danger: " + %2d (2) + "/10" = 40 chars.',
      },
      {
        method: 'format',
        prompt: 'Line 3: Base bounty - label left-justified, value right-justified',
        skeleton: 'String baseLine = String.format("%-30s%10d", "Base Bounty:", {{baseBounty}});',
        answer: '"%-30s%10d", "Base Bounty:", {{baseBounty}}',
        inputs: [
          { type: 'format-string', expected: '"%-30s%10d", "Base Bounty:", {{baseBounty}}' },
        ],
        explanation: '%-30s left-aligns label; %10d right-aligns value = 40 chars.',
      },
      {
        method: 'format',
        prompt: 'Line 4: Bonus - build label with percentage, same 40-char alignment',
        skeleton: 'String bonusLine = String.format("%-30s%10.0f", "Bonus (" + Math.round({{bonusRate}} * 100) + "%):", {{baseBounty}} * {{bonusRate}});',
        answer: '"%-30s%10.0f", "Bonus (" + Math.round({{bonusRate}} * 100) + "%):", {{baseBounty}} * {{bonusRate}}',
        inputs: [
          { type: 'format-string', expected: '"%-30s%10.0f", "Bonus (" + Math.round({{bonusRate}} * 100) + "%):", {{baseBounty}} * {{bonusRate}}' },
        ],
        explanation: 'Build label with %; %-30s and %10.0f (rounds automatically) = 40 chars total.',
      },
      {
        method: 'format',
        prompt: 'Line 5: Total reward with calculation, same alignment',
        skeleton: 'String total = String.format("%-30s%10.0f", "TOTAL REWARD:", {{baseBounty}} * (1 + {{bonusRate}}));',
        answer: '"%-30s%10.0f", "TOTAL REWARD:", {{baseBounty}} * (1 + {{bonusRate}})',
        inputs: [
          { type: 'format-string', expected: '"%-30s%10.0f", "TOTAL REWARD:", {{baseBounty}} * (1 + {{bonusRate}})' },
        ],
        explanation: 'Calculate total as base × (1 + rate); %-30s and %10.0f (rounds automatically) = 40 chars.',
      },
    ],
  },
  // ===== FANTASY-MENU BEGINNER =====
  {
    id: 'fantasy-menu-beginner',
    title: 'Tavern Menu Items',
    difficulty: 'beginner',
    theme: 'fantasy-menu',
    scenario: 'Print simple menu items for a fantasy tavern.',
    gridWidth: 30,
    gridHeight: 4,
    variableTemplates: [
      {
        key: 'food1',
        type: 'String',
        names: ['dish', 'item', 'entree'],
        values: ['Dragon Stew', 'Elf Bread', 'Goblin Skewers', 'Ogre Soup'],
      },
      {
        key: 'food2',
        type: 'String',
        names: ['dessert', 'sweet', 'treat'],
        values: ['Pixie Cake', 'Fairy Tart', 'Magic Pie', 'Wizard Cookies'],
      },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Print menu header',
        skeleton: 'System.out.printf("MENU%n");',
        answer: 'MENU%n',
        inputs: [
          { type: 'constant-string', expected: 'MENU%n' },
        ],
        explanation: 'Constant string followed by %n for newline.',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Print first food item',
        skeleton: 'System.out.printf("%s%n", {{food1}});',
        answer: '%s%n, {{food1}}',
        inputs: [
          { type: 'format-string', expected: '%s%n' },
          { type: 'variable', expected: '{{food1}}' },
        ],
        explanation: 'Use %s for string; %n for newline.',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Print dessert',
        skeleton: 'System.out.printf("%s%n", {{food2}});',
        answer: '%s%n, {{food2}}',
        inputs: [
          { type: 'format-string', expected: '%s%n' },
          { type: 'variable', expected: '{{food2}}' },
        ],
        explanation: 'Same format for consistency.',
      },
    ],
  },
  // ===== FANTASY-MENU ADVANCED =====
  {
    id: 'fantasy-menu-advanced',
    title: 'Enchanted Tavern Receipt',
    difficulty: 'advanced',
    theme: 'fantasy-menu',
    scenario: 'Create a formatted fantasy tavern receipt with aligned item descriptions, prices, subtotal, and calculated tax and total.',
    gridWidth: 42,
    gridHeight: 8,
    variableTemplates: [
      {
        key: 'item1',
        type: 'String',
        names: ['dish1', 'main1'],
        values: ['Dragon Stew', 'Elf Bread', 'Mermaid Sushi', 'Griffin Roast'],
      },
      {
        key: 'price1',
        type: 'double',
        names: ['cost1', 'amount1'],
        range: { min: 8.5, max: 22.0, precision: 2 },
      },
      {
        key: 'item2',
        type: 'String',
        names: ['dish2', 'main2'],
        values: ['Goblin Skewers', 'Phoenix Eggs', 'Dwarf Pie', 'Hydra Burger'],
      },
      {
        key: 'price2',
        type: 'double',
        names: ['cost2', 'amount2'],
        range: { min: 9.0, max: 24.0, precision: 2 },
      },
      {
        key: 'taxRate',
        type: 'double',
        names: ['rate', 'tax'],
        values: [0.08, 0.09, 0.1],
      },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Format first item with left-aligned name (14 chars) and right-aligned price',
        skeleton: 'String line1 = String.format("%-14s $%7.2f", {{item1}}, {{price1}});',
        answer: '"%-14s $%7.2f", {{item1}}, {{price1}}',
        inputs: [
          { type: 'format-string', expected: '"%-14s $%7.2f", {{item1}}, {{price1}}' },
        ],
        explanation: '%-14s left-aligns dish name in 14 chars; $%7.2f right-aligns price.',
      },
      {
        method: 'format',
        prompt: 'Line 2: Format second item with same alignment',
        skeleton: 'String line2 = String.format("%-14s $%7.2f", {{item2}}, {{price2}});',
        answer: '"%-14s $%7.2f", {{item2}}, {{price2}}',
        inputs: [
          { type: 'format-string', expected: '"%-14s $%7.2f", {{item2}}, {{price2}}' },
        ],
        explanation: 'Matching format ensures column alignment across lines.',
      },
      {
        method: 'format',
        prompt: 'Line 3: Calculate and format subtotal',
        skeleton: 'String subtotal = String.format("%-14s $%7.2f", "SUBTOTAL", {{price1}} + {{price2}});',
        answer: '"%-14s $%7.2f", "SUBTOTAL", {{price1}} + {{price2}}',
        inputs: [
          { type: 'format-string', expected: '"%-14s $%7.2f", "SUBTOTAL", {{price1}} + {{price2}}' },
        ],
        explanation: 'Sum the two prices for the subtotal amount.',
      },
      {
        method: 'format',
        prompt: 'Line 4: Format tax line with percentage and calculated tax amount. Show percentage and write tax calculation.',
        skeleton: 'String taxLine = String.format("%-14s $%7.2f", "TAX " + Math.round({{taxRate}} * 100) + "%", ({{price1}} + {{price2}}) * {{taxRate}});',
        answer: '"%-14s $%7.2f", "TAX " + Math.round({{taxRate}} * 100) + "%", ({{price1}} + {{price2}}) * {{taxRate}}',
        inputs: [
          { type: 'format-string', expected: '"%-14s $%7.2f", "TAX " + Math.round({{taxRate}} * 100) + "%", ({{price1}} + {{price2}}) * {{taxRate}}' },
        ],
        explanation: 'Format: left-align label (14 chars), right-align price. Build tax label with percentage; calculate tax amount.',
      },
      {
        method: 'format',
        prompt: 'Line 5: Calculate and format total. Write the complete calculation expression.',
        skeleton: 'String total = String.format("%-14s $%7.2f", "TOTAL", ({{price1}} + {{price2}}) * (1 + {{taxRate}}));',
        answer: '"%-14s $%7.2f", "TOTAL", ({{price1}} + {{price2}}) * (1 + {{taxRate}})',
        inputs: [
          { type: 'format-string', expected: '"%-14s $%7.2f", "TOTAL", ({{price1}} + {{price2}}) * (1 + {{taxRate}})' },
        ],
        explanation: 'Total = subtotal × (1 + tax rate). Use same alignment format.',
      },
    ],
  },
  // ===== SPY-BADGE BEGINNER =====
  {
    id: 'spy-badge-beginner',
    title: 'Spy ID Card - Basic',
    difficulty: 'beginner',
    theme: 'spy-badge',
    scenario: 'Print a simple spy ID card with name and rank.',
    gridWidth: 28,
    gridHeight: 3,
    variableTemplates: [
      {
        key: 'agentName',
        type: 'String',
        names: ['agent', 'spy'],
        values: ['Phoenix', 'Viper', 'Shadow', 'Eagle'],
      },
      {
        key: 'rank',
        type: 'int',
        names: ['level', 'clearance'],
        range: { min: 1, max: 7, step: 1 },
      },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Agent name',
        skeleton: 'System.out.printf("Agent: %s%n", {{agentName}});',
        answer: 'Agent: %s%n, {{agentName}}',
        inputs: [
          { type: 'format-string', expected: 'Agent: %s%n' },
          { type: 'variable', expected: '{{agentName}}' },
        ],
        explanation: '%s for string; %n for newline.',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Rank level',
        skeleton: 'System.out.printf("Rank: %d%n", {{rank}});',
        answer: 'Rank: %d%n, {{rank}}',
        inputs: [
          { type: 'format-string', expected: 'Rank: %d%n' },
          { type: 'variable', expected: '{{rank}}' },
        ],
        explanation: '%d for integer; %n for newline.',
      },
    ],
  },
  // ===== SPY-BADGE INTERMEDIATE =====
  {
    id: 'spy-badge-intermediate',
    title: 'Spy Badge - Formatted ID',
    difficulty: 'intermediate',
    theme: 'spy-badge',
    scenario: 'Create a formatted spy badge with aligned columns and field widths.',
    gridWidth: 42,
    gridHeight: 3,
    variableTemplates: [
      {
        key: 'codeName',
        type: 'String',
        names: ['handle', 'alias'],
        values: ['Specter', 'Cipher', 'Ghost', 'Whisper'],
      },
      {
        key: 'missionCount',
        type: 'int',
        names: ['ops', 'missions'],
        range: { min: 5, max: 50, step: 5 },
      },
      {
        key: 'successRate',
        type: 'double',
        names: ['accuracy', 'record'],
        range: { min: 85.0, max: 99.9, precision: 1 },
      },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Codename left-aligned, mission count right-aligned',
        skeleton: 'String badge = String.format("%-12s | Ops: %3d", {{codeName}}, {{missionCount}});',
        answer: '%-12s | Ops: %3d, {{codeName}}, {{missionCount}}',
        inputs: [
          { type: 'format-string', expected: '%-12s | Ops: %3d, {{codeName}}, {{missionCount}}' },
        ],
        explanation: '%-12s left-aligns name; %3d right-aligns mission count.',
      },
      {
        method: 'format',
        prompt: 'Line 2: Success rate with 1 decimal',
        skeleton: 'String stats = String.format("Success Rate: %6.1f%%", {{successRate}});',
        answer: 'Success Rate: %6.1f%%, {{successRate}}',
        inputs: [
          { type: 'format-string', expected: 'Success Rate: %6.1f%%, {{successRate}}' },
        ],
        explanation: '%6.1f right-aligns in 6 chars with 1 decimal; %% prints %.',
      },
    ],
  },
];

export function getRandomChallenge(theme = null, difficulty = null) {
  let pool = CHALLENGE_DEFINITIONS;
  if (theme) pool = pool.filter((c) => c.theme === theme);
  if (difficulty) pool = pool.filter((c) => c.difficulty === difficulty);
  if (pool.length === 0) pool = CHALLENGE_DEFINITIONS;
  const def = randomChoice(pool);
  return instantiate(def);
}

export { CHALLENGE_DEFINITIONS, formatWithMask, evaluateArgs };
export default CHALLENGE_DEFINITIONS;
