import { formatList } from './formatters';
import { buildChoicePool } from './choices';

export default function indexGet(baseList, listName, useWords) {
  const idx = Math.floor(Math.random() * baseList.length);
  return {
    prompt: `${listName} = ${formatList(baseList)}\nresult = ${listName}[${idx}]`,
    question: 'What value is stored in result?',
    expected: String(baseList[idx]),
    type: 'value',
    list: baseList,
    variant: 'value-selection',
    choices: buildChoicePool(baseList, [], useWords),
    op: 'index-get',
    idx,
  };
}
