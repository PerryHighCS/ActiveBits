import { formatList } from './formatters.js'
import { buildListFinalChoices, buildLengthChoices } from './choices.js'
import { randomItem } from './utils.js'
import { WORD_LISTS } from './pools.js'

export default function appendOp(
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
      variant: string
      choices: unknown[]
    }
  | {
      prompt: string
      question: string
      expected: string
      type: 'number'
      list: unknown[]
      op: string
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
      variant: string
      choices: unknown[]
      queryIdx: number
    } {
  const toAppend = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20)
  const mutated = [...baseList, toAppend]
  const mode = Math.random()
  const choices = buildListFinalChoices(mutated, useWords, baseList.length, mutated.length)
  if (mode < 0.45) {
    return {
      prompt: `${listName} = ${formatList(baseList)}\n${listName}.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend})`,
      question: `After this append, what is the full ${listName} list?`,
      expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
      type: 'list',
      list: mutated,
      op: 'append',
      variant: 'list-final',
      choices,
    }
  }
  if (mode < 0.7) {
    return {
      prompt: `${listName} = ${formatList(baseList)}\n${listName}.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend})`,
      question: `What is len(${listName}) now?`,
      expected: String(mutated.length),
      type: 'number',
      list: baseList,
      op: 'append',
      variant: 'number-choice',
      choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
    }
  }
  const queryIdx = Math.floor(Math.random() * mutated.length)
  return {
    prompt: `${listName} = ${formatList(baseList)}\n${listName}.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend})`,
    question: `After the append, what is ${listName}[${queryIdx}]?`,
    expected: String(mutated[queryIdx]),
    type: 'value',
    list: mutated,
    op: 'append',
    variant: 'value-selection',
    choices,
    queryIdx,
  }
}
