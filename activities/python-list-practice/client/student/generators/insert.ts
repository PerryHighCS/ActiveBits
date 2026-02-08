import { formatList } from './formatters.js'
import { buildListFinalChoices, buildLengthChoices } from './choices.js'
import { randomItem } from './utils.js'
import { WORD_LISTS } from './pools.js'

export default function insertOp(
  baseList: unknown[],
  listName: string,
  useWords: boolean,
):
  | {
      prompt: string
      question: string
      expected: string
      type: 'number'
      list: unknown[]
      op: string
      idx: number
      variant: string
      choices: unknown[]
    }
  | {
      prompt: string
      question: string
      expected: string
      type: 'list'
      list: unknown[]
      op: string
      idx: number
      variant: string
      choices: unknown[]
    } {
  const idx = Math.floor(Math.random() * (baseList.length + 1))
  const val = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20)
  const mutated = [...baseList]
  mutated.splice(idx, 0, val)
  const askLength = Math.random() < 0.35
  const chipPool = buildListFinalChoices(
    mutated,
    useWords,
    baseList.length,
    mutated.length,
    Math.min(mutated.length + 2, 10),
  )
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
      choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
    }
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
  }
}
