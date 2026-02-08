import { formatList } from './formatters.js'
import { buildChoicePool } from './choices.js'

export default function indexGet(
  baseList: unknown[],
  listName: string,
  useWords: boolean,
): {
  prompt: string
  question: string
  expected: string
  type: 'value'
  list: unknown[]
  variant: string
  choices: unknown[]
  op: string
  idx: number
} {
  const idx = Math.floor(Math.random() * baseList.length)
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
  }
}
