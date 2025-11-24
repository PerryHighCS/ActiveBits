import { buildRangeSequence } from './range';
import { formatList } from './formatters';
import { buildRangeChoicePool } from './choices';
import { randomItem } from './utils';

export default function forRangeOp(baseList, listName, useWords) {
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
      op: 'for-range',
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
    op: 'for-range',
    start,
    stop,
    step,
    variant: 'value-selection',
    choices: buildRangeChoicePool(rangeValues, stop),
  };
}
