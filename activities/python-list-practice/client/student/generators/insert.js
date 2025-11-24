import { formatList } from './formatters';
import { buildListFinalChoices, buildLengthChoices } from './choices';
import { randomItem } from './utils';
import { WORD_LISTS } from './pools';

export default function insertOp(baseList, listName, useWords) {
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
      op: 'insert',
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
    op: 'insert',
    idx,
    variant: 'insert-final',
    choices: chipPool,
  };
}
