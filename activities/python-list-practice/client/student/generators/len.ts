import { formatList } from './formatters.js'
import { buildLengthChoices } from './choices.js'
import { buildWordList, generateNumberList } from './utils.js'

export default function lenOp(
  _baseList: unknown[],
  listName: string,
  useWords: boolean,
): {
  prompt: string
  question: string
  expected: string
  type: 'number'
  list: unknown[]
  op: string
  variant: string
  choices: unknown[]
} {
  const targetLength = Math.floor(Math.random() * 7) + 2
  const workingList = useWords ? buildWordList(targetLength) : generateNumberList(targetLength, targetLength)
  const finalLenChoices = buildLengthChoices(workingList.length, workingList[workingList.length - 1])
  return {
    prompt: `${listName} = ${formatList(workingList)}\nlength = len(${listName})`,
    question: 'What value is assigned to length?',
    expected: String(workingList.length),
    type: 'number',
    list: workingList,
    op: 'len',
    variant: 'number-choice',
    choices: finalLenChoices,
  }
}
