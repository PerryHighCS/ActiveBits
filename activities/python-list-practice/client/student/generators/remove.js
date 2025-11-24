import { formatList } from './formatters';
import { buildListFinalChoices, buildChoicePool, buildLengthChoices } from './choices';
import { randomItem } from './utils';

export default function removeOp(baseList, listName, useWords) {
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
      op: 'remove',
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
      op: 'remove',
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
    op: 'remove',
    variant: 'value-selection',
    choices,
    queryIdx,
    needsDuplicate,
  };
}
