import { formatList } from './formatters';
import { buildLengthChoices } from './choices';
import { buildWordList, generateNumberList } from './utils';

export default function lenOp(baseList, listName, useWords) {
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
    op: 'len',
    variant: 'number-choice',
    choices: finalLenChoices,
  };
}
