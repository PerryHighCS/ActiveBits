// Challenge generation utilities for Python List Practice
import { WORD_LISTS } from './generators/pools';
import { randomItem, generateNumberList, randomListName, sanitizeName } from './generators/utils';
import { formatForRangeDetail, formatRangeLenDetail, formatList } from './generators/formatters';
import indexGet from './generators/indexGet';
import indexSet from './generators/indexSet';
import lenOp from './generators/len';
import appendOp from './generators/append';
import removeOp from './generators/remove';
import insertOp from './generators/insert';
import popOp from './generators/pop';
import forRangeOp from './generators/forRange';
import rangeLenOp from './generators/rangeLen';
import forEachOp from './generators/forEach';

export const OPERATIONS = [
  'index-get',
  'index-set',
  'len',
  'append',
  'remove',
  'insert',
  'pop',
  'for-range',
  'range-len',
  'for-each',
];

export const QUESTION_LABELS = {
  'index-get': 'Index (read)',
  'index-set': 'Index (write)',
  len: 'len(list)',
  append: 'append()',
  remove: 'remove()',
  insert: 'insert()',
  pop: 'pop()',
  'for-range': 'for range loop',
  'range-len': 'range(len(list))',
  'for-each': 'for each loop',
  all: 'All question types',
};

const HINT_DEFINITIONS = {
  'index-get': 'Use list[index] to read the value at that position. Remember that indexes start at 0.',
  'index-set': 'Assign with list[index] = value to replace the element stored at that index.',
  len: 'len(list) returns how many items are currently stored in the list.',
  append: 'append(value) adds the value to the end of the list and increases the length by 1.',
  remove: 'remove(value) searches for the first matching value and deletes it. The remaining items shift left.',
  insert: 'insert(index, value) places the value at the given index and shifts everything at or after that index to the right.',
  pop: 'pop() removes and returns the last item. pop(index) removes and returns the item at that index and shifts every later element left.',
  'for-range': 'A for range loop runs once for every number produced by range(start, stop, step).',
  'range-len': 'range(len(list)) produces valid indexes for the list (optionally starting somewhere else or skipping with a step).',
  'for-each': 'A for-each loop walks through each item in the list one value at a time.',
};

export function getHintDefinition(challenge) {
  if (!challenge) return 'Look closely at the code to understand what each line is doing.';
  return HINT_DEFINITIONS[challenge.op] || 'Read the code carefully and trace what it does to the list.';
}

export function buildAnswerDetails(challenge) {
  if (!challenge) return [];
  const details = [];
  if (challenge.filterDescription) {
    details.push(challenge.filterDescription);
  }
  if (challenge.doubleLoopInfo) {
    challenge.doubleLoopInfo.loops.forEach((loop, idx) => {
      const label = challenge.doubleLoopInfo.loops.length > 1 ? `Loop ${idx + 1}` : 'This loop';
      const detail = loop.type === 'range-len'
        ? formatRangeLenDetail(label, loop)
        : formatForRangeDetail(label, loop.start, loop.stop, loop.step);
      const printer = loop.prints === 'value'
        ? 'It prints the list value at that index.'
        : loop.prints === 'index'
          ? 'It prints the index number itself.'
          : 'It prints the loop variable.';
      details.push(`${detail} ${printer}`);
    });
  } else if (challenge.op === 'for-range' && typeof challenge.start === 'number') {
    details.push(formatForRangeDetail('This loop', challenge.start, challenge.stop, challenge.step));
  } else if (challenge.rangeLenInfo) {
    details.push(formatRangeLenDetail('This loop', challenge.rangeLenInfo));
  }
  if (challenge.needsDuplicate) {
    details.push('remove(value) only deletes the first matching value, so later duplicates stay in the list.');
  }
  return details;
}

// helper implementations moved to separate modules (imported at top)

function generateChallenge(allowedTypesSet = new Set(['all'])) {
  const useWords = Math.random() < 0.5;
  const baseList = useWords ? [...randomItem(WORD_LISTS)] : generateNumberList();
  const listName = randomListName(useWords);
  const typeSet = allowedTypesSet instanceof Set ? allowedTypesSet : new Set(allowedTypesSet || []);
  const availableOps = typeSet.has('all')
    ? OPERATIONS
    : OPERATIONS.filter((operation) => typeSet.has(operation));
  const opPool = availableOps.length > 0 ? availableOps : OPERATIONS;
  const op = randomItem(opPool);

  const opMap = {
    'index-get': indexGet,
    'index-set': indexSet,
    'len': lenOp,
    'append': appendOp,
    'remove': removeOp,
    'insert': insertOp,
    'pop': popOp,
    'for-range': forRangeOp,
    'range-len': rangeLenOp,
    'for-each': forEachOp,
  };

  const generator = opMap[op] || forEachOp;
  return generator(baseList, listName, useWords);
}


export function createChallengeForTypes(typeSet) {
  let normalized;
  if (typeSet instanceof Set) {
    normalized = new Set(typeSet);
  } else if (Array.isArray(typeSet)) {
    normalized = new Set(typeSet);
  } else {
    normalized = new Set(['all']);
  }
  const guardSet = normalized.has('all') ? null : normalized;
  for (let i = 0; i < 10; i += 1) {
    const candidate = generateChallenge(normalized);
    if (!guardSet || guardSet.has(candidate.op)) {
      return candidate;
    }
  }
  return generateChallenge(new Set(['all']));
}

export { sanitizeName };
