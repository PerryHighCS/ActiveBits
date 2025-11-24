import { formatList } from './formatters';
import { buildListFinalChoices, buildChoicePool } from './choices';
import { randomItem } from './utils';
import { WORD_LISTS } from './pools';

export default function rangeLenOp(baseList, listName, useWords) {
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
      op: 'range-len',
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
    op: 'range-len',
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
