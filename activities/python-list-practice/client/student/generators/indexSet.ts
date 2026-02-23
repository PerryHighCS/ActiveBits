import { formatList } from './formatters.js'
import { buildChoicePool, buildListFinalChoices } from './choices.js'
import { randomItem } from './utils.js'
import { WORD_LISTS } from './pools.js'

export default function indexSet(
  baseList: unknown[],
  listName: string,
  useWords: boolean,
):
  | {
      prompt: string
      question: string
      expected: string
      type: 'list'
      list: unknown[]
      op: string
      idx: number
      mutated: unknown[]
      variant: string
      choices: unknown[]
    }
  | {
      prompt: string
      question: string
      expected: string
      type: 'value'
      list: unknown[]
      op: string
      idx: number
      mutated: unknown[]
      variant: string
      choices: unknown[]
    } {
  const idx = Math.floor(Math.random() * baseList.length)
  const newVal = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20)
  const mutated = [...baseList]
  mutated[idx] = newVal
  const buildFinal = Math.random() < 0.65
  const displayList = buildListFinalChoices(mutated, useWords, baseList.length, mutated.length, 8, baseList)
  if (buildFinal) {
    return {
      prompt: `${listName} = ${formatList(baseList)}\n${listName}[${idx}] = ${typeof newVal === 'string' ? `'${newVal}'` : newVal}`,
      question: `After this assignment, what is the full ${listName} list?`,
      expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
      type: 'list',
      list: mutated,
      op: 'index-set',
      idx,
      mutated,
      variant: 'list-final',
      choices: displayList,
    }
  }
  return {
    prompt: `${listName} = ${formatList(baseList)}\n${listName}[${idx}] = ${typeof newVal === 'string' ? `'${newVal}'` : newVal}`,
    question: `After this assignment, what is ${listName}[${idx}]?`,
    expected: String(newVal),
    type: 'value',
    list: baseList,
    op: 'index-set',
    idx,
    mutated,
    variant: 'index-value',
    choices: buildChoicePool(mutated, [baseList[idx]], useWords),
  }
}
