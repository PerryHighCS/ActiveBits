import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Button from '@src/components/ui/Button';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import '../styles.css';
import SessionHeader from './components/SessionHeader';
import QuestionHintSection from './components/QuestionHintSection';
import FocusSummary from './components/FocusSummary';
import InteractiveListSection from './components/InteractiveListSection';
import AnswerPanel from './components/AnswerPanel';
import HintDisplay from './components/HintDisplay';

const WORD_LISTS = [
  ['apple', 'banana', 'cherry', 'date', 'fig', 'grape'],
  ['red', 'green', 'blue', 'yellow', 'purple', 'orange'],
  ['cat', 'dog', 'bird', 'fish', 'hamster', 'turtle'],
  ['river', 'mountain', 'desert', 'forest', 'valley', 'canyon'],
  ['robot', 'android', 'cyborg', 'drone', 'machine', 'server'],
  ['pizza', 'burger', 'salad', 'pasta', 'taco', 'sushi'],
  ['rocket', 'planet', 'comet', 'asteroid', 'galaxy'],
  ['violin', 'piano', 'trumpet', 'drum', 'flute'],
  ['python', 'javascript', 'ruby', 'go', 'swift'],
  ['spring', 'summer', 'autumn', 'winter', 'monsoon'],
];

const NUMBER_LIST_NAMES = ['nums', 'values', 'totals', 'scores', 'readings', 'levels', 'counts', 'digits'];
const WORD_LIST_NAMES = ['words', 'names', 'labels', 'terms', 'entries', 'titles', 'things', 'items'];

function generateNumberList(minLen = 4, maxLen = 6) {
  const range = Math.max(0, maxLen - minLen);
  const length = Math.floor(Math.random() * (range + 1)) + minLen;
  const start = Math.floor(Math.random() * 20) - 10;
  const step = Math.random() < 0.5 ? 1 : Math.floor(Math.random() * 3) + 2;
  const ascending = Math.random() < 0.5;
  const list = [];
  for (let i = 0; i < length; i += 1) {
    const value = start + (ascending ? i : -i) * step + Math.floor(Math.random() * 3);
    list.push(value);
  }
  return list;
}

function buildWordList(length) {
  const base = [...randomItem(WORD_LISTS)];
  const pool = [...base];
  const allWords = WORD_LISTS.flat();
  while (pool.length < length) {
    pool.push(randomItem(allWords));
  }
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, length);
}

function randomListName(useWords) {
  const pool = useWords ? WORD_LIST_NAMES : NUMBER_LIST_NAMES;
  return randomItem(pool);
}

function buildLengthChoices(length, lastValue) {
  const extras = [Math.max(0, length - 1), length + 1, length + 2];
  if (lastValue !== undefined) {
    extras.push(lastValue);
  }
  return buildChoicePool([length], extras, false, 6);
}

function buildListFinalChoices(values, useWords, baseLength = null, newLength = null, targetSize = 8, extraValues = []) {
  const baseKeys = new Set();
  const baseValues = [];
  if (Array.isArray(values)) {
    values.forEach((val) => {
      if (val === undefined) return;
      const key = typeof val === 'string' ? `s:${val}` : `n:${val}`;
      if (baseKeys.has(key)) return;
      baseKeys.add(key);
      baseValues.push(val);
    });
  }
  const candidateExtras = [];
  const extraKeys = new Set();
  const addCandidate = (val) => {
    if (val === undefined) return;
    const key = typeof val === 'string' ? `s:${val}` : `n:${val}`;
    if (baseKeys.has(key) || extraKeys.has(key)) return;
    extraKeys.add(key);
    candidateExtras.push(val);
  };
  if (Array.isArray(extraValues)) {
    extraValues.forEach(addCandidate);
  }
  if (typeof baseLength === 'number') addCandidate(baseLength);
  if (typeof newLength === 'number' && newLength !== baseLength) addCandidate(newLength);
  const neededExtras = Math.max(0, targetSize - baseValues.length);
  const extraPool = neededExtras > 0 ? buildChoicePool([], candidateExtras, useWords, neededExtras) : [];
  const finalList = [...baseValues];
  if (neededExtras > 0) {
    finalList.push(...extraPool.slice(0, neededExtras));
  }
  for (let i = finalList.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [finalList[i], finalList[j]] = [finalList[j], finalList[i]];
  }
  return finalList;
}

function buildRangeChoicePool(values, stopValue = null) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const spanStart = Math.min(minVal, maxVal);
  const spanEnd = Math.max(minVal, maxVal);
  const contiguous = [];
  for (let n = spanStart; n <= spanEnd; n += 1) {
    contiguous.push(n);
  }
  const extras = [spanStart - 1, spanEnd + 1];
  if (typeof stopValue === 'number' && !contiguous.includes(stopValue)) {
    extras.push(stopValue);
  }
  return buildListFinalChoices(contiguous, false, null, null, Math.min(12, contiguous.length + 2), extras);
}

function buildRangeSequence(start, stop, step) {
  const values = [];
  if (step === 0) return values;
  if (step > 0) {
    for (let current = start; current < stop; current += step) {
      values.push(current);
    }
  } else {
    for (let current = start; current > stop; current += step) {
      values.push(current);
    }
  }
  return values;
}

const OPERATIONS = [
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

const QUESTION_LABELS = {
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

function getHintDefinition(challenge) {
  if (!challenge) return 'Look closely at the code to understand what each line is doing.';
  return HINT_DEFINITIONS[challenge.op] || 'Read the code carefully and trace what it does to the list.';
}

function formatForRangeDetail(label, start, stop, step) {
  const displayStep = step !== 1 ? `, ${step}` : '';
  const direction = step > 0 ? 'up' : 'down';
  const magnitude = Math.abs(step) === 1 ? '' : ` in jumps of ${Math.abs(step)}`;
  return `${label} uses range(${start}, ${stop}${displayStep}), so it counts ${direction}${magnitude} and stops before ${stop}.`;
}

function formatRangeLenDetail(label, info) {
  const { start, stop, step } = info;
  const stepText = step === 1 ? '' : ` with a step of ${step}`;
  return `${label} walks indexes from ${start} up to ${stop} via range(len(list))${stepText}, stopping before ${stop}.`;
}

function buildAnswerDetails(challenge) {
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

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatList(list) {
  return `[${list.map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(', ')}]`;
}

function buildChoicePool(baseValues, extras = [], useWords = false, targetSize = 8) {
  const seen = new Set();
  const uniquePool = [];
  const addValue = (value) => {
    const key = typeof value === 'string' ? `s:${value}` : `n:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePool.push(value);
    }
  };
  [...baseValues, ...extras].forEach(addValue);
  const wordsSource = WORD_LISTS.flat();
  while (uniquePool.length < targetSize) {
    const candidate = useWords ? randomItem(wordsSource) : Math.floor(Math.random() * 20);
    addValue(candidate);
  }
  return uniquePool.sort(() => Math.random() - 0.5);
}

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

  switch (op) {
    case 'index-get': {
      const idx = Math.floor(Math.random() * baseList.length);
      return {
        prompt: `${listName} = ${formatList(baseList)}\nresult = ${listName}[${idx}]`,
        question: 'What value is stored in result?',
        expected: String(baseList[idx]),
        type: 'value',
        list: baseList,
        variant: 'value-selection',
        choices: buildChoicePool(baseList, [], useWords),
        op,
        idx,
      };
    }
    case 'index-set': {
      const idx = Math.floor(Math.random() * baseList.length);
      const newVal = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20);
      const mutated = [...baseList];
      mutated[idx] = newVal;
      const buildFinal = Math.random() < 0.65;
      const displayList = buildListFinalChoices(mutated, useWords, baseList.length, mutated.length, 8, baseList);
      if (buildFinal) {
        return {
          prompt: `${listName} = ${formatList(baseList)}\n${listName}[${idx}] = ${typeof newVal === 'string' ? `'${newVal}'` : newVal}`,
          question: `After this assignment, what is the full ${listName} list?`,
          expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
          type: 'list',
          list: mutated,
          op,
          idx,
          mutated,
          variant: 'list-final',
          choices: displayList,
        };
      }
      return {
        prompt: `${listName} = ${formatList(baseList)}\n${listName}[${idx}] = ${typeof newVal === 'string' ? `'${newVal}'` : newVal}`,
        question: `After this assignment, what is ${listName}[${idx}]?`,
        expected: String(newVal),
        type: 'value',
        list: baseList,
        op,
        idx,
        mutated,
        variant: 'index-value',
        choices: buildChoicePool(mutated, [baseList[idx]], useWords),
      };
    }
    case 'len': {
      const targetLength = Math.floor(Math.random() * 7) + 2; // 2-8 items
      const workingList = useWords
        ? buildWordList(targetLength)
        : generateNumberList(targetLength, targetLength);
      const finalLenChoices = buildLengthChoices(workingList.length, workingList[workingList.length - 1]);
      return {
        prompt: `${listName} = ${formatList(workingList)}\nlength = len(${listName})`,
        question: 'What value is assigned to length?',
        expected: String(workingList.length),
        type: 'number',
        list: workingList,
        op,
        variant: 'number-choice',
        choices: finalLenChoices,
      };
    }
    case 'append': {
      const toAppend = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20);
      const mutated = [...baseList, toAppend];
      const mode = Math.random();
      const choices = buildListFinalChoices(mutated, useWords, baseList.length, mutated.length);
      if (mode < 0.45) {
        return {
          prompt: `${listName} = ${formatList(baseList)}\n${listName}.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend})`,
          question: `After this append, what is the full ${listName} list?`,
          expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
          type: 'list',
          list: mutated,
          op,
          variant: 'list-final',
          choices,
        };
      } if (mode < 0.7) {
        return {
          prompt: `${listName} = ${formatList(baseList)}\n${listName}.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend})`,
          question: `What is len(${listName}) now?`,
          expected: String(mutated.length),
          type: 'number',
          list: baseList,
          op,
          variant: 'number-choice',
          choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
        };
      }
      const queryIdx = Math.floor(Math.random() * mutated.length);
      return {
        prompt: `${listName} = ${formatList(baseList)}\n${listName}.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend})`,
        question: `After the append, what is ${listName}[${queryIdx}]?`,
        expected: String(mutated[queryIdx]),
        type: 'value',
        list: mutated,
        op,
        variant: 'value-selection',
        choices,
        queryIdx,
      };
    }
    case 'remove': {
      const needsDuplicate = baseList.length > 2 && Math.random() < 0.5;
      const val = randomItem(baseList);
      const workingList = needsDuplicate ? [...baseList, val] : [...baseList];
      const mutated = [...baseList];
      const removalSource = needsDuplicate ? [...workingList] : mutated;
      const removalIndex = removalSource.indexOf(val);
      if (removalIndex !== -1) {
        removalSource.splice(removalIndex, 1);
      }
      const displayList = needsDuplicate ? removalSource : mutated;
      const choices = buildListFinalChoices(
        displayList.length ? displayList : workingList,
        useWords,
        workingList.length,
        displayList.length,
        8,
        workingList,
      );
      const mode = Math.random();
      if (displayList.length > 0 && mode < 0.5) {
        return {
          prompt: `${listName} = ${formatList(workingList)}\n${listName}.remove(${typeof val === 'string' ? `'${val}'` : val})`,
          question: `After this removal, what is the full ${listName} list?`,
          expected: `[${displayList.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
          type: 'list',
          list: displayList,
          op,
          variant: 'list-final',
          choices,
          needsDuplicate,
        };
      } if (mode < 0.75) {
        return {
          prompt: `${listName} = ${formatList(workingList)}\n${listName}.remove(${typeof val === 'string' ? `'${val}'` : val})`,
          question: `What is len(${listName}) now?`,
          expected: String(Math.max(0, workingList.length - 1)),
          type: 'number',
          list: workingList,
          op,
          variant: 'number-choice',
          choices: buildLengthChoices(Math.max(0, workingList.length - 1), displayList[displayList.length - 1]),
          needsDuplicate,
        };
      }
      const targetList = displayList.length ? displayList : workingList;
      const queryIdx = Math.floor(Math.random() * targetList.length);
      return {
        prompt: `${listName} = ${formatList(workingList)}\n${listName}.remove(${typeof val === 'string' ? `'${val}'` : val})`,
        question: `After the removal, what is ${listName}[${queryIdx}]?`,
        expected: String(targetList[queryIdx]),
        type: 'value',
        list: targetList,
        op,
        variant: 'value-selection',
        choices,
        queryIdx,
        needsDuplicate,
      };
    }
    case 'insert': {
      const idx = Math.floor(Math.random() * (baseList.length + 1));
      const val = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20);
      const mutated = [...baseList];
      mutated.splice(idx, 0, val);
      const askLength = Math.random() < 0.35;
      const chipPool = buildListFinalChoices(
        mutated,
        useWords,
        baseList.length,
        mutated.length,
        Math.min(mutated.length + 2, 10),
      );
      if (askLength) {
        return {
          prompt: `${listName} = ${formatList(baseList)}\n${listName}.insert(${idx}, ${typeof val === 'string' ? `'${val}'` : val})`,
          question: `What is len(${listName}) now?`,
          expected: String(mutated.length),
          type: 'number',
          list: baseList,
          op,
          idx,
          variant: 'number-choice',
          choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1], val),
        };
      }
      return {
        prompt: `${listName} = ${formatList(baseList)}\n${listName}.insert(${idx}, ${typeof val === 'string' ? `'${val}'` : val})`,
        question: `After this insert, what is the full ${listName} list?`,
        expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
        type: 'list',
        list: mutated,
        op,
        idx,
        variant: 'insert-final',
        choices: chipPool,
      };
    }
    case 'pop': {
      const workingList = baseList.length > 0 ? [...baseList] : [useWords ? 'x' : 0];
      const hasIndexVersion = Math.random() < 0.5 && workingList.length > 1;
      if (hasIndexVersion) {
        const idx = Math.floor(Math.random() * workingList.length);
        const removed = workingList[idx];
        const mutated = [...workingList];
        mutated.splice(idx, 1);
        const mode = Math.random();
        if (mode < 0.4) {
          return {
            prompt: `${listName} = ${formatList(workingList)}\nresult = ${listName}.pop(${idx})`,
            question: `What value is assigned to result when pop(${idx}) is called?`,
            expected: String(removed),
            type: 'value',
            list: workingList,
            op,
            variant: 'value-selection',
            choices: buildChoicePool(workingList, [], useWords),
          };
        } if (mode < 0.65) {
          return {
            prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop(${idx})`,
            question: `After this pop, what is len(${listName})?`,
            expected: String(mutated.length),
            type: 'number',
            list: mutated,
            op,
            variant: 'number-choice',
            choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
          };
        } if (mode < 0.85) {
          return {
            prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop(${idx})`,
            question: `After this pop, what is the full ${listName} list?`,
            expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
            type: 'list',
            list: mutated,
            op,
            variant: 'list-final',
            choices: buildListFinalChoices(mutated, useWords, workingList.length, mutated.length, 8, workingList),
          };
        }
        const queryIdx = Math.floor(Math.random() * mutated.length);
        return {
          prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop(${idx})`,
          question: `After pop(${idx}), what is ${listName}[${queryIdx}]?`,
          expected: String(mutated[queryIdx]),
          type: 'value',
          list: mutated,
          op,
          variant: 'value-selection',
          choices: buildChoicePool(mutated, [], useWords),
        };
      }
      const fallback = workingList[workingList.length - 1];
      const mutated = [...workingList];
      mutated.pop();
      const mode = Math.random();
      if (mode < 0.4) {
        return {
          prompt: `${listName} = ${formatList(workingList)}\nresult = ${listName}.pop()`,
          question: 'What value is assigned to result?',
          expected: String(fallback),
          type: 'value',
          list: workingList,
          op,
          variant: 'value-selection',
          choices: buildChoicePool(workingList, [], useWords),
        };
      } if (mode < 0.65) {
        return {
          prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop()`,
          question: `After this pop, what is len(${listName})?`,
          expected: String(mutated.length),
          type: 'number',
          list: mutated,
          op,
          variant: 'number-choice',
          choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
        };
      } if (mode < 0.85) {
        return {
          prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop()`,
          question: `After this pop, what is the full ${listName} list?`,
          expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
          type: 'list',
          list: mutated,
          op,
          variant: 'list-final',
          choices: buildListFinalChoices(mutated, useWords, workingList.length, mutated.length, 8, workingList),
        };
      }
      if (!mutated.length) {
        return {
          prompt: `${listName} = ${formatList(workingList)}\nresult = ${listName}.pop()`,
          question: 'What value is assigned to result?',
          expected: String(fallback),
          type: 'value',
          list: workingList,
          op,
          variant: 'value-selection',
          choices: buildChoicePool(workingList, [], useWords),
        };
      }
      const queryIdx = Math.floor(Math.random() * mutated.length);
      return {
        prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop()`,
        question: `After the pop, what is ${listName}[${queryIdx}]?`,
        expected: String(mutated[queryIdx]),
        type: 'value',
        list: mutated,
        op,
        variant: 'value-selection',
        choices: buildChoicePool(mutated, [], useWords),
      };
    }
    case 'for-range': {
      const possibleSteps = [-3, -2, -1, 1, 2, 3];
      const step = randomItem(possibleSteps);
      const count = Math.floor(Math.random() * 3) + 3; // 3-5 numbers
      const start = Math.floor(Math.random() * 11) - 5; // -5 to 5
      const absStep = Math.abs(step);
      const allowOffset = absStep > 1 && Math.random() < 0.6;
      const remainderOffset = allowOffset ? (Math.floor(Math.random() * (absStep - 1)) + 1) : 0;
      const baseStop = start + (count * step);
      const stop = step > 0 ? baseStop + remainderOffset : baseStop - remainderOffset;
      const rangeValues = buildRangeSequence(start, stop, step);
      const mode = Math.random();
      const showStep = step === 1 ? Math.random() < 0.7 : true;
      if (mode < 0.4) {
        let step2 = randomItem(possibleSteps.filter((v) => v !== step));
        if (step2 === step) step2 = step * -1 || (step === 1 ? -1 : 1);
        let start2 = stop - (count * step2);
        const tweak = Math.floor(Math.random() * 3) - 1;
        start2 += step2 * tweak;
        if (step2 > 0 && start2 >= stop) start2 = stop - step2;
        if (step2 < 0 && start2 <= stop) start2 = stop - step2;
        let secondRangeValues = buildRangeSequence(start2, stop, step2);
        if (!secondRangeValues.length) {
          start2 = stop - (count * step2);
          secondRangeValues = buildRangeSequence(start2, stop, step2);
        }
        const combinedValues = [...rangeValues, ...secondRangeValues];
        const expectedSequence = combinedValues.join(',');
        return {
          prompt: `for i in range(${start}, ${stop}${showStep ? `, ${step}` : ''}):\n    print(i)\nfor j in range(${start2}, ${stop}${step2 !== 1 ? `, ${step2}` : ''}):\n    print(j)`,
          question: 'What numbers are printed?',
          expected: expectedSequence,
          type: 'list',
          op,
          start,
          stop,
          step,
          variant: 'value-selection',
          choices: buildRangeChoicePool(combinedValues, stop),
          doubleLoopInfo: {
            type: 'for-range',
            loops: [
              { start, stop, step, prints: 'index' },
              { start: start2, stop, step: step2, prints: 'index' },
            ],
          },
        };
      }
      const displayedStep = showStep ? `, ${step}` : '';
      return {
        prompt: `for i in range(${start}, ${stop}${displayedStep}):\n    print(i)`,
        question: 'What numbers are printed?',
        expected: rangeValues.join(','),
        type: 'list',
        op,
        start,
        stop,
        step,
        variant: 'value-selection',
        choices: buildRangeChoicePool(rangeValues, stop),
      };
    }
    case 'range-len': {
      let workingList = [...baseList];
      if (workingList.length < 3) {
        while (workingList.length < 3) {
          workingList.push(useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20));
        }
      }
      const maxItems = Math.floor(Math.random() * 4) + 3;
      workingList = workingList.slice(0, Math.min(maxItems, workingList.length));
      const useValues = Math.random() < 0.5;
      const skipSize = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 2 : 1;
      const displayZero = Math.random() < 0.5;
      const fixedStart = Math.random() < 0.35 ? 0 : Math.floor(Math.random() * skipSize);
      const startOffset = Math.random() < 0.5 ? fixedStart : Math.floor(Math.random() * skipSize);
      const secondarySkip = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 2 : skipSize;
      const showPrimaryZeroStart = startOffset !== 0 || displayZero;
      const showPrimaryStepWhenOne = skipSize !== 1 ? true : Math.random() < 0.5;
      const showSecondaryZeroStart = startOffset !== 0 ? true : Math.random() < 0.5;
      const showSecondaryStepWhenOne = secondarySkip !== 1 ? true : Math.random() < 0.5;
      const totalLength = workingList.length;
      const buildRangeCall = (startValue, stepValue, showZeroStart, includeStepWhenOne) => {
        const shouldAddStep = stepValue !== 1 || includeStepWhenOne;
        const args = [];
        const includeStart = showZeroStart || startValue !== 0 || shouldAddStep;
        if (includeStart) {
          args.push(String(startValue));
        }
        args.push(`len(${listName})`);
        if (shouldAddStep) {
          args.push(String(stepValue));
        }
        return `range(${args.join(', ')})`;
      };
      const primaryRangeCall = buildRangeCall(startOffset, skipSize, showPrimaryZeroStart, showPrimaryStepWhenOne);
      let adjustedSecondarySkip = secondarySkip;
      if (adjustedSecondarySkip >= workingList.length) {
        adjustedSecondarySkip = Math.max(1, Math.floor(adjustedSecondarySkip / 2));
      }
      const secondaryRangeCall = buildRangeCall(startOffset, adjustedSecondarySkip, showSecondaryZeroStart, showSecondaryStepWhenOne);
      const primaryRangeInfo = { start: startOffset, stop: totalLength, step: skipSize };
      const secondaryRangeInfo = { start: startOffset, stop: totalLength, step: adjustedSecondarySkip };
      const primaryIndices = [];
      const secondaryIndices = [];
      for (let i = startOffset; i < workingList.length; i += skipSize) {
        primaryIndices.push(i);
      }
      for (let i = startOffset; i < workingList.length; i += adjustedSecondarySkip) {
        secondaryIndices.push(i);
      }
      const hasPrimary = primaryIndices.length > 0;
      const hasSecondary = secondaryIndices.length > 0;
      if (!hasPrimary && !hasSecondary) {
        const fallbackIndices = [Math.min(startOffset, workingList.length - 1)];
        primaryIndices.push(...fallbackIndices);
      }
      const before = -1;
      const after = workingList.length;
      const selectionSet = new Set();
      for (let n = before; n <= after; n += 1) {
        selectionSet.add(n);
      }
      selectionSet.add(after + 1);
      const selectionList = Array.from(selectionSet).sort((a, b) => a - b);
      if (useValues) {
        const includeSecondLoop = secondaryIndices.length > 0 && Math.random() < 0.45;
        const rangesMatch = primaryIndices.length === secondaryIndices.length
          && primaryIndices.every((value, index) => value === secondaryIndices[index]);
        const includeSecondaryValues = includeSecondLoop && (!rangesMatch || Math.random() < 0.5);
        const includeSecondaryIndices = includeSecondLoop && rangesMatch && !includeSecondaryValues;
        const combinedIndices = includeSecondaryValues || includeSecondaryIndices
          ? [...primaryIndices, ...secondaryIndices]
          : primaryIndices;
        const valuePrompt = includeSecondaryValues
          ? `${listName} = ${formatList(workingList)}\nfor i in ${primaryRangeCall}:\n    print(${listName}[i])\nfor j in ${secondaryRangeCall}:\n    print(${listName}[j])`
          : includeSecondaryIndices
            ? `${listName} = ${formatList(workingList)}\nfor i in ${primaryRangeCall}:\n    print(${listName}[i])\nfor j in ${secondaryRangeCall}:\n    print(j)`
            : `${listName} = ${formatList(workingList)}\nfor i in ${primaryRangeCall}:\n    print(${listName}[i])`;
        const expectedSequence = includeSecondaryIndices
          ? [...primaryIndices.map((idx) => workingList[idx]), ...secondaryIndices.map((idx) => idx)].map(String).join(',')
          : combinedIndices.map((idx) => workingList[idx]).map(String).join(',');
        const choicePool = includeSecondaryIndices
          ? buildListFinalChoices([...selectionList, ...workingList], false, null, null, Math.min(12, selectionList.length + workingList.length))
          : buildChoicePool(workingList, [], useWords);
        const loopsInfo = [
          { type: 'range-len', start: primaryRangeInfo.start, stop: primaryRangeInfo.stop, step: primaryRangeInfo.step, prints: 'value' },
        ];
        if (includeSecondaryValues) {
          loopsInfo.push({ type: 'range-len', start: secondaryRangeInfo.start, stop: secondaryRangeInfo.stop, step: secondaryRangeInfo.step, prints: 'value' });
        } else if (includeSecondaryIndices) {
          loopsInfo.push({ type: 'range-len', start: secondaryRangeInfo.start, stop: secondaryRangeInfo.stop, step: secondaryRangeInfo.step, prints: 'index' });
        }
        return {
          prompt: valuePrompt,
          question: 'What values are printed?',
          expected: expectedSequence,
          type: 'list',
          op,
          list: workingList,
          rangeValues: combinedIndices,
          choices: choicePool,
          variant: 'value-selection',
          rangeLenInfo: primaryRangeInfo,
          doubleLoopInfo: loopsInfo.length > 1 ? { type: 'range-len', loops: loopsInfo } : null,
        };
      }
      const numberChoicesBase = [...selectionList, ...workingList];
      const numberChoices = buildListFinalChoices(
        numberChoicesBase,
        false,
        null,
        null,
        Math.min(12, selectionList.length + workingList.length),
      );
      const rangesMatch = primaryIndices.length === secondaryIndices.length
        && primaryIndices.every((value, index) => value === secondaryIndices[index]);
      const includeValuesInNumbers = rangesMatch ? true : Math.random() < 0.5;
      const numbersPrompt = includeValuesInNumbers
        ? `${listName} = ${formatList(workingList)}\nfor i in ${primaryRangeCall}:\n    print(i)\nfor j in ${secondaryRangeCall}:\n    print(${listName}[j])`
        : `${listName} = ${formatList(workingList)}\nfor i in ${primaryRangeCall}:\n    print(${listName}[i])\nfor j in ${secondaryRangeCall}:\n    print(j)`;
      const numbersExpected = includeValuesInNumbers
        ? [...primaryIndices.map((idx) => idx), ...secondaryIndices.map((idx) => workingList[idx])].map(String).join(',')
        : [...primaryIndices.map((idx) => workingList[idx]), ...secondaryIndices.map((idx) => idx)].map(String).join(',');
      return {
        prompt: numbersPrompt,
        question: 'What values or indices are printed?',
        expected: numbersExpected,
        type: 'list',
        op,
        variant: 'value-selection',
        choices: numberChoices,
        rangeValues: includeValuesInNumbers ? [...primaryIndices, ...secondaryIndices] : [...primaryIndices, ...secondaryIndices],
        rangeLenInfo: primaryRangeInfo,
        doubleLoopInfo: {
          type: 'range-len',
          loops: [
            {
              type: 'range-len',
              start: primaryRangeInfo.start,
              stop: primaryRangeInfo.stop,
              step: primaryRangeInfo.step,
              prints: includeValuesInNumbers ? 'index' : 'value',
            },
            {
              type: 'range-len',
              start: secondaryRangeInfo.start,
              stop: secondaryRangeInfo.stop,
              step: secondaryRangeInfo.step,
              prints: includeValuesInNumbers ? 'value' : 'index',
            },
          ],
        },
      };
    }
    case 'for-each':
    default: {
      const workingList = [...baseList];
      const listLiteral = formatList(workingList);
      const mode = Math.random();
      let prompt;
      let filtered = workingList;
      let filterDescription = null;
      if (!useWords) {
        const numbersOnly = workingList.filter((v) => typeof v === 'number');
        if (numbersOnly.length > 0) {
          const minVal = Math.min(...numbersOnly);
          const maxVal = Math.max(...numbersOnly);
          const numericMode = Math.random();
          if (numericMode < 0.33) {
            const threshold = minVal + Math.floor(Math.random() * 4);
            prompt = `${listName} = ${listLiteral}\nfor num in ${listName}:\n    if num > ${threshold}:\n        print(num)`;
            filtered = numbersOnly.filter((num) => num > threshold);
            filterDescription = `The if statement filters numbers greater than ${threshold}.`;
          } else if (numericMode < 0.66) {
            const threshold = maxVal - Math.floor(Math.random() * 4);
            prompt = `${listName} = ${listLiteral}\nfor num in ${listName}:\n    if num < ${threshold}:\n        print(num)`;
            filtered = numbersOnly.filter((num) => num < threshold);
            filterDescription = `The if statement filters numbers less than ${threshold}.`;
          } else {
            const divisor = Math.floor(Math.random() * 3) + 2;
            prompt = `${listName} = ${listLiteral}\nfor num in ${listName}:\n    if num % ${divisor} == 0:\n        print(num)`;
            filtered = numbersOnly.filter((num) => num % divisor === 0);
            filterDescription = `The if statement filters numbers divisible by ${divisor}.`;
          }
        }
      } else if (useWords) {
        const stringMode = Math.random();
        if (stringMode < 0.25) {
          const minLength = Math.floor(Math.random() * 3) + 4;
          prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if len(word) >= ${minLength}:\n        print(word)`;
          filtered = workingList.filter((word) => String(word).length >= minLength);
          filterDescription = `The if statement filters words with length at least ${minLength}.`;
        } else if (stringMode < 0.5) {
          const maxLength = Math.floor(Math.random() * 3) + 3;
          prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if len(word) <= ${maxLength}:\n        print(word)`;
          filtered = workingList.filter((word) => String(word).length <= maxLength);
          filterDescription = `The if statement filters words with length at most ${maxLength}.`;
        } else if (stringMode < 0.75) {
          const letter = String.fromCharCode(97 + Math.floor(Math.random() * 26));
          prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if '${letter}' in word:\n        print(word)`;
          filtered = workingList.filter((word) => String(word).toLowerCase().includes(letter));
          filterDescription = `The if statement filters words containing '${letter}'.`;
        } else {
          const letter = String.fromCharCode(97 + Math.floor(Math.random() * 26));
          prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if word.startswith('${letter}'):\n        print(word)`;
          filtered = workingList.filter((word) => String(word).toLowerCase().startsWith(letter));
          filterDescription = `The if statement filters words starting with '${letter}'.`;
        }
      }
      if (!filtered || filtered.length === 0) {
        prompt = `${listName} = ${listLiteral}\nfor item in ${listName}:\n    print(item)`;
        filtered = workingList;
        filterDescription = 'This loop prints every item because there is no filtering condition.';
      }
      return {
        prompt,
        question: 'What values are printed?',
        expected: filtered.map(String).join(','),
        type: 'list',
        list: workingList,
        op,
        variant: 'value-selection',
        choices: buildListFinalChoices(workingList, useWords, null, null, Math.min(workingList.length + 4, 12)),
        filterDescription,
      };
    }
  }
}

function sanitizeName(name) {
  if (!name) return null;
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) return null;
  return trimmed;
}

function createChallengeForTypes(typeSet) {
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

export default function PythonListPractice({ sessionData }) {
  const [studentName, setStudentName] = useState('');
  const [submittedName, setSubmittedName] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const wsRef = useRef(null);
  const attachSessionEndedHandler = useSessionEndedHandler(wsRef);
  const [allowedTypes, setAllowedTypes] = useState(() => new Set(['all']));
  const [challenge, setChallenge] = useState(() => createChallengeForTypes(new Set(['all'])));
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [showNext, setShowNext] = useState(false);
  const [stats, setStats] = useState({ total: 0, correct: 0, streak: 0, longestStreak: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  const answerInputRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selectedValueIndex, setSelectedValueIndex] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectedSequence, setSelectedSequence] = useState([]);
  const [isDraggingRange, setIsDraggingRange] = useState(false);
  const rangeStartRef = useRef(null);
  const statsRef = useRef(stats);
  const [insertSelections, setInsertSelections] = useState([]);
  const statsLoadedRef = useRef(false);
  const sessionId = sessionData?.sessionId;
  const isSolo = !sessionId || sessionId.startsWith('solo-');
  const [hintStage, setHintStage] = useState('none');

  const allowedTypeList = useMemo(() => {
    if (allowedTypes.has('all')) {
      return ['all'];
    }
    return OPERATIONS.filter((type) => allowedTypes.has(type));
  }, [allowedTypes]);
  const soloQuestionTypes = useMemo(() => ([
    { id: 'all', label: 'All question types' },
    ...OPERATIONS.filter((t) => t !== 'all').map((type) => ({ id: type, label: QUESTION_LABELS[type] || type })),
  ]), []);
  const statsStorageKey = useMemo(() => {
    if (!sessionId || !studentId || isSolo) return null;
    return `python-list-practice-stats-${sessionId}-${studentId}`;
  }, [sessionId, studentId, isSolo]);
  const applySelectedTypes = useCallback((types) => {
    const normalized = Array.isArray(types) && types.length > 0 ? types : ['all'];
    const nextSet = new Set(normalized);
    setAllowedTypes(nextSet);
    setChallenge(createChallengeForTypes(nextSet));
    setAnswer('');
    setFeedback(null);
    setShowNext(false);
  }, []);
  const handleSoloToggleType = useCallback((typeId) => {
    const next = new Set(allowedTypes);
    if (typeId === 'all') {
      next.clear();
      next.add('all');
    } else {
      if (next.has('all')) {
        next.clear();
      }
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      if (next.size === 0) {
        next.add('all');
      }
    }
    applySelectedTypes(Array.from(next));
  }, [allowedTypes, applySelectedTypes]);

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const storedName = localStorage.getItem(`python-list-practice-name-${sessionId}`);
    const storedId = localStorage.getItem(`python-list-practice-id-${sessionId}`);
    if (storedName) {
      setStudentName(storedName);
    }
    if (storedName && storedId) {
      setSubmittedName(storedName);
      setStudentId(storedId);
    } else if (storedId && !storedName) {
      setStudentId(storedId);
    }
  }, [sessionId]);
  useEffect(() => {
    if (!showNext && answerInputRef.current) {
      answerInputRef.current.focus();
    }
  }, [challenge, showNext]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  // Connect to WebSocket after name submit to mark student as connected (for roster)
  useEffect(() => {
    if (!sessionId || isSolo) return undefined;
    let ignore = false;
    const fetchConfig = async () => {
      try {
        const res = await fetch(`/api/python-list-practice/${sessionId}`);
        if (!res.ok) throw new Error('Failed to load session');
        const data = await res.json();
        if (!ignore) {
          applySelectedTypes(data.selectedQuestionTypes || ['all']);
        }
      } catch (err) {
        console.error('Failed to load session config', err);
      }
    };
    fetchConfig();
    return () => {
      ignore = true;
    };
  }, [sessionId, applySelectedTypes, isSolo]);

  const ensureStudentId = () => {
    if (studentId) return studentId;
    const generated = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `stu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setStudentId(generated);
    if (sessionId) {
      localStorage.setItem(`python-list-practice-id-${sessionId}`, generated);
    }
    return generated;
  };

  const submitName = (e) => {
    e.preventDefault();
    const sanitized = sanitizeName(studentName);
    if (!sanitized) {
      setError('Enter a valid name');
      return;
    }
    setSubmittedName(sanitized);
    const id = ensureStudentId();
    if (sessionId) {
      localStorage.setItem(`python-list-practice-name-${sessionId}`, sanitized);
      localStorage.setItem(`python-list-practice-id-${sessionId}`, id);
    }
    setError(null);
  };

  const sendStats = useCallback(async (nextStats) => {
    if (!sessionId || !submittedName || !studentId) return;
    try {
      await fetch(`/api/python-list-practice/${sessionId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: submittedName, studentId, stats: nextStats }),
      });
    } catch (err) {
      console.error('Failed to send stats', err);
    }
  }, [sessionId, studentId, submittedName]);

  useEffect(() => {
    if (!statsStorageKey || statsLoadedRef.current) return;
    try {
      const stored = localStorage.getItem(statsStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStats(parsed);
        statsRef.current = parsed;
        if (submittedName) {
          sendStats(parsed);
        }
      }
    } catch (err) {
      console.warn('Failed to load saved stats', err);
    } finally {
      statsLoadedRef.current = true;
    }
  }, [statsStorageKey, sendStats, submittedName]);

  useEffect(() => {
    if (!statsStorageKey || !statsLoadedRef.current) return;
    try {
      localStorage.setItem(statsStorageKey, JSON.stringify(stats));
    } catch (err) {
      console.warn('Failed to save stats', err);
    }
  }, [stats, statsStorageKey]);

  useEffect(() => {
    if (!sessionId || isSolo) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const encodedSession = encodeURIComponent(sessionId);
    const nameParam = submittedName ? `&studentName=${encodeURIComponent(submittedName)}` : '';
    const idParam = studentId ? `&studentId=${encodeURIComponent(studentId)}` : '';
    const wsUrl = `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${encodedSession}${nameParam}${idParam}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    attachSessionEndedHandler(ws);
    ws.onopen = () => {
      // send a zeroed stats payload on connect so the dashboard sees the student immediately
      if (submittedName) {
        sendStats(statsRef.current);
      }
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'questionTypesUpdate') {
          applySelectedTypes(msg.payload?.selectedQuestionTypes || ['all']);
        }
      } catch (err) {
        console.error('WS message error', err);
      }
    };
    ws.onerror = (err) => console.error('WS error', err);
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, submittedName, applySelectedTypes, sendStats, isSolo]);

  const isListBuildVariant = challenge?.variant === 'insert-final' || challenge?.variant === 'list-final';

  const normalizeListAnswer = useCallback((text) => {
    if (!text) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    const noBrackets = trimmed.replace(/^\[|\]$/g, '');
    return noBrackets.split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => token.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'))
      .join(',');
  }, []);

  const normalizedExpected = useMemo(() => {
    if (challenge.type === 'list') return normalizeListAnswer(challenge.expected);
    return (challenge.expected || '').trim();
  }, [challenge, normalizeListAnswer]);

  const hintDefinition = useMemo(() => getHintDefinition(challenge), [challenge]);
  const answerDetails = useMemo(() => buildAnswerDetails(challenge), [challenge]);

  const handleShowDefinitionHint = () => {
    if (hintStage === 'none') {
      setHintStage('definition');
    }
  };

  const handleShowAnswerHint = () => {
    setHintStage('answer');
  };

  const checkAnswer = () => {
    let cleaned = challenge.type === 'list'
      ? normalizeListAnswer(answer)
      : answer.trim();
    let expectedComparison = normalizedExpected;

    const needsCommaTolerance = challenge.type !== 'list'
      && (normalizedExpected.includes(',') || cleaned.includes(','));
    if (needsCommaTolerance) {
      cleaned = normalizeListAnswer(cleaned);
      expectedComparison = normalizeListAnswer(normalizedExpected);
    }

    const isCorrect = cleaned.length > 0 && cleaned === expectedComparison;
    const hintsUsed = hintStage !== 'none';
    const streakIncrement = isCorrect && !hintsUsed ? stats.streak + 1 : 0;
    const nextStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect && !hintsUsed ? 1 : 0),
      streak: streakIncrement,
      longestStreak: Math.max(stats.longestStreak, streakIncrement),
    };
    setStats(nextStats);
    setFeedback({
      isCorrect,
      message: isCorrect ? 'Correct! 🎉' : `Not quite. Expected: ${challenge.expected}`,
    });
    sendStats(nextStats);
    setShowNext(true);
  };

  const nextChallenge = () => {
    setChallenge(createChallengeForTypes(allowedTypes));
    setAnswer('');
    setFeedback(null);
    setShowNext(false);
  };

  const interactiveList = useMemo(() => {
    if (challenge?.choices) return challenge.choices;
    if (!challenge) return [];
    if (challenge.op === 'index-set' && Array.isArray(challenge.mutated)) {
      return challenge.mutated;
    }
    if (Array.isArray(challenge.list)) {
      return challenge.list;
    }
    if (challenge.op === 'for-range') {
      const total = Math.max(0, (challenge.stop ?? 0) - (challenge.start ?? 0));
      return Array.from({ length: total }, (_, i) => (challenge.start ?? 0) + i);
    }
    return [];
  }, [challenge]);

  useEffect(() => {
    if (isListBuildVariant) {
      setAnswer(insertSelections.length ? `[${insertSelections.join(', ')}]` : '');
    }
  }, [insertSelections, isListBuildVariant]);

  const supportsSequenceSelection = !!(challenge && ['range-len', 'for-each'].includes(challenge.op));

  useEffect(() => {
    setSelectedIndex(null);
    setSelectedValueIndex(null);
    setSelectedRange(null);
    setSelectedSequence([]);
    rangeStartRef.current = null;
    setIsDraggingRange(false);
    setInsertSelections([]);
    setHintStage('none');
  }, [challenge]);

  const getValueForIndex = useCallback((idx) => {
    if (!challenge) return undefined;
    if (Array.isArray(challenge.choices)
      && (challenge.op === 'insert'
        || ['list-final', 'value-selection', 'index-value', 'number-choice'].includes(challenge.variant)
        || challenge.op === 'for-range')) {
      return challenge.choices[idx];
    }
    if (challenge.op === 'index-set' && Array.isArray(challenge.mutated)) {
      return challenge.mutated[idx];
    }
    if (!Array.isArray(interactiveList) || idx < 0 || idx >= interactiveList.length) {
      return undefined;
    }
    if (challenge.op === 'pop' && idx !== interactiveList.length - 1) {
      return undefined;
    }
    return interactiveList[idx];
  }, [challenge, interactiveList]);

  const applyRangeSelection = useCallback((startIdx, endIdx) => {
    if (!supportsSequenceSelection || !interactiveList.length) return;
    const rangeStart = Math.max(0, Math.min(startIdx, endIdx));
    const rangeEnd = Math.min(interactiveList.length - 1, Math.max(startIdx, endIdx));
    setSelectedRange([rangeStart, rangeEnd]);
    const indices = [];
    const direction = startIdx <= endIdx ? 1 : -1;
    for (let i = startIdx; direction > 0 ? i <= endIdx : i >= endIdx; i += direction) {
      if (i >= 0 && i < interactiveList.length) {
        indices.push(i);
      }
    }
    setSelectedSequence(indices);
    const slice = indices.map((idx) => interactiveList[idx]);
    if (isListBuildVariant) {
      const formatted = slice.map((item) => (typeof item === 'string' ? `'${item}'` : String(item)));
      setInsertSelections(formatted);
    } else {
      setAnswer(slice.map((item) => String(item)).join(', '));
    }
  }, [interactiveList, supportsSequenceSelection, isListBuildVariant]);

  const handleSequenceSelectionClick = useCallback((idx, event = null) => {
    if (!supportsSequenceSelection || showNext) return;
    if (isDraggingRange) return;
    if (event && event.shiftKey && selectedSequence.length > 0) {
      const last = selectedSequence[selectedSequence.length - 1];
      applyRangeSelection(last, idx);
      rangeStartRef.current = null;
      setIsDraggingRange(false);
      return;
    }
    const values = interactiveList[idx];
    if (isListBuildVariant) {
      const formatted = typeof values === 'string' ? `'${values}'` : String(values);
      setInsertSelections((prev) => [...prev, formatted]);
    } else {
      setAnswer((prev) => (prev ? `${prev}, ${String(values)}` : String(values)));
    }
  }, [applyRangeSelection, interactiveList, isDraggingRange, selectedSequence, showNext, supportsSequenceSelection, isListBuildVariant]);

  const startRangeSelection = useCallback((idx) => {
    if (!supportsSequenceSelection || showNext) return;
    rangeStartRef.current = idx;
    setIsDraggingRange(true);
    setSelectedRange([idx, idx]);
  }, [applyRangeSelection, showNext, supportsSequenceSelection]);

  const extendRangeSelection = useCallback((idx) => {
    if (!supportsSequenceSelection || rangeStartRef.current === null || showNext) return;
    applyRangeSelection(rangeStartRef.current, idx);
  }, [applyRangeSelection, showNext, supportsSequenceSelection]);

  const finishRangeSelection = useCallback(() => {
    if (!supportsSequenceSelection) return;
    rangeStartRef.current = null;
    setIsDraggingRange(false);
  }, [supportsSequenceSelection]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRange) {
        finishRangeSelection();
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [finishRangeSelection, isDraggingRange]);

  const handleIndexClick = (idx, event) => {
    if (!challenge || showNext) return;
    setSelectedIndex(idx);
    setSelectedValueIndex(null);
    setSelectedRange(null);
    rangeStartRef.current = null;
    if (challenge.op === 'pop' && idx !== interactiveList.length - 1) {
      // allow any selection for pop questions
    }
    const formatted = String(idx);
    setAnswer((prev) => (prev ? `${prev}, ${formatted}` : formatted));
  };

  const handleValueClick = (idx, event) => {
    if (!challenge || showNext) return;
    const value = getValueForIndex(idx);
    const resolvedValue = value !== undefined ? value : interactiveList[idx];
    setSelectedValueIndex(idx);
    setSelectedIndex(null);
    setSelectedRange(null);
    rangeStartRef.current = null;
    if (isListBuildVariant) {
      const formatted = typeof resolvedValue === 'string' ? `'${resolvedValue}'` : String(resolvedValue);
      setInsertSelections((prev) => [...prev, formatted]);
      return;
    }
    if (challenge.op === 'for-range') {
      if (resolvedValue !== undefined) {
        setAnswer((prev) => (prev ? `${prev}, ${String(resolvedValue)}` : String(resolvedValue)));
      }
      return;
    }
    if (supportsSequenceSelection) {
      handleSequenceSelectionClick(idx, event);
      return;
    }
    if (['index-get', 'index-set', 'pop'].includes(challenge.op)) {
      if (resolvedValue !== undefined) {
        setAnswer(String(resolvedValue));
      }
    } else if (['value-selection', 'number-choice', 'index-value'].includes(challenge.variant)) {
      if (resolvedValue !== undefined) {
        setAnswer(String(resolvedValue));
      }
    }
  };

  const QUESTION_OPTIONS = useMemo(() => OPERATIONS.filter((t) => t !== 'all'), []);

  if (!submittedName && !isSolo) {
    return (
      <div className="python-list-bg flex items-center justify-center px-4">
        <div className="python-list-join">
          <h1 className="text-2xl font-bold mb-4 text-center text-emerald-900">Join Python List Practice</h1>
          <p className="text-sm text-emerald-800 text-center mb-4">
            Practice indexing, loops, len, append/remove/insert/pop, and range.
          </p>
          <form onSubmit={submitName} className="space-y-3">
            <label className="python-list-label">
              Your Name
              <input
                ref={nameRef}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="python-list-input mt-1"
                placeholder="Enter your name"
                required
              />
            </label>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
              Start Practicing
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="python-list-bg">
      <div className="python-list-container">
        {!isSolo && <SessionHeader submittedName={submittedName} sessionId={sessionId} stats={stats} />}
        {isSolo && (
          <SessionHeader activityName="Python List Practice" stats={stats} simple />
        )}

        <div className="python-list-content">
          {isSolo && (
            <div className="python-list-card">
              <p className="text-sm font-semibold text-emerald-900 mb-2">Choose question types</p>
              <div className="flex flex-wrap gap-2">
                {soloQuestionTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={`python-list-chip ${allowedTypes.has(type.id) ? 'selected' : ''}`}
                    onClick={() => handleSoloToggleType(type.id)}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="python-list-card">
            {!isSolo && (
              <FocusSummary allowedTypeList={allowedTypeList} allowedTypes={allowedTypes} labels={QUESTION_LABELS} />
            )}
            <QuestionHintSection
              challenge={challenge}
              hintStage={hintStage}
              showHintButtons={!feedback}
              onShowHint={handleShowDefinitionHint}
              onShowAnswer={handleShowAnswerHint}
              hintDefinition={hintDefinition}
              answerDetails={answerDetails}
              showHintBody={false}
            />
            <InteractiveListSection
              challenge={challenge}
              interactiveList={interactiveList}
              isListBuildVariant={isListBuildVariant}
              supportsSequenceSelection={supportsSequenceSelection}
              selectedRange={selectedRange}
              selectedSequence={selectedSequence}
              selectedIndex={selectedIndex}
              selectedValueIndex={selectedValueIndex}
              onIndexClick={handleIndexClick}
              onValueClick={handleValueClick}
              onStartRange={startRangeSelection}
              onExtendRange={(idx) => extendRangeSelection(idx)}
              onFinishRange={finishRangeSelection}
            />
            <HintDisplay
              hintStage={hintStage}
              hintDefinition={hintDefinition}
              answerDetails={answerDetails}
              expected={challenge?.expected}
            />
            <AnswerPanel
              answer={answer}
              onAnswerChange={(value) => setAnswer(value)}
              challenge={challenge}
              answerRef={answerInputRef}
              disabled={showNext}
              loading={loading}
              onSubmit={checkAnswer}
              onClear={() => {
                setAnswer('');
                setInsertSelections([]);
              }}
              feedback={feedback}
              onNext={nextChallenge}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
