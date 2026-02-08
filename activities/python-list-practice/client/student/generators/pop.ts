import { formatList } from './formatters.js'
import { buildListFinalChoices, buildChoicePool, buildLengthChoices } from './choices.js'

export default function popOp(
  baseList: unknown[],
  listName: string,
  useWords: boolean,
):
  | {
      prompt: string
      question: string
      expected: string
      type: 'value'
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
      type: 'list'
      list: unknown[]
      op: string
      variant: string
      choices: unknown[]
    } {
  const workingList = baseList.length > 0 ? [...baseList] : [useWords ? 'x' : 0]
  const hasIndexVersion = Math.random() < 0.5 && workingList.length > 1
  if (hasIndexVersion) {
    const idx = Math.floor(Math.random() * workingList.length)
    const removed = workingList[idx]
    const mutated = [...workingList]
    mutated.splice(idx, 1)
    const mode = Math.random()
    if (mode < 0.4) {
      return {
        prompt: `${listName} = ${formatList(workingList)}\nresult = ${listName}.pop(${idx})`,
        question: `What value is assigned to result when pop(${idx}) is called?`,
        expected: String(removed),
        type: 'value',
        list: workingList,
        op: 'pop',
        variant: 'value-selection',
        choices: buildChoicePool(workingList, [], useWords),
      }
    }
    if (mode < 0.65) {
      return {
        prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop(${idx})`,
        question: `After this pop, what is len(${listName})?`,
        expected: String(mutated.length),
        type: 'number',
        list: mutated,
        op: 'pop',
        variant: 'number-choice',
        choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
      }
    }
    if (mode < 0.85) {
      return {
        prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop(${idx})`,
        question: `After this pop, what is the full ${listName} list?`,
        expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
        type: 'list',
        list: mutated,
        op: 'pop',
        variant: 'list-final',
        choices: buildListFinalChoices(mutated, useWords, workingList.length, mutated.length, 8, workingList),
      }
    }
    const queryIdx = Math.floor(Math.random() * mutated.length)
    return {
      prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop(${idx})`,
      question: `After pop(${idx}), what is ${listName}[${queryIdx}]?`,
      expected: String(mutated[queryIdx]),
      type: 'value',
      list: mutated,
      op: 'pop',
      variant: 'value-selection',
      choices: buildChoicePool(mutated, [], useWords),
    }
  }
  const fallback = workingList[workingList.length - 1]
  const mutated = [...workingList]
  mutated.pop()
  const mode = Math.random()
  if (mode < 0.4) {
    return {
      prompt: `${listName} = ${formatList(workingList)}\nresult = ${listName}.pop()`,
      question: 'What value is assigned to result?',
      expected: String(fallback),
      type: 'value',
      list: workingList,
      op: 'pop',
      variant: 'value-selection',
      choices: buildChoicePool(workingList, [], useWords),
    }
  }
  if (mode < 0.65) {
    return {
      prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop()`,
      question: `After this pop, what is len(${listName})?`,
      expected: String(mutated.length),
      type: 'number',
      list: mutated,
      op: 'pop',
      variant: 'number-choice',
      choices: buildLengthChoices(mutated.length, mutated[mutated.length - 1]),
    }
  }
  if (mode < 0.85) {
    return {
      prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop()`,
      question: `After this pop, what is the full ${listName} list?`,
      expected: `[${mutated.map((item) => (typeof item === 'string' ? `'${item}'` : String(item))).join(', ')}]`,
      type: 'list',
      list: mutated,
      op: 'pop',
      variant: 'list-final',
      choices: buildListFinalChoices(mutated, useWords, workingList.length, mutated.length, 8, workingList),
    }
  }
  if (!mutated.length) {
    return {
      prompt: `${listName} = ${formatList(workingList)}\nresult = ${listName}.pop()`,
      question: 'What value is assigned to result?',
      expected: String(fallback),
      type: 'value',
      list: workingList,
      op: 'pop',
      variant: 'value-selection',
      choices: buildChoicePool(workingList, [], useWords),
    }
  }
  const queryIdx = Math.floor(Math.random() * mutated.length)
  return {
    prompt: `${listName} = ${formatList(workingList)}\n${listName}.pop()`,
    question: `After the pop, what is ${listName}[${queryIdx}]?`,
    expected: String(mutated[queryIdx]),
    type: 'value',
    list: mutated,
    op: 'pop',
    variant: 'value-selection',
    choices: buildChoicePool(mutated, [], useWords),
  }
}
