import { formatList } from './formatters.js'
import { buildListFinalChoices } from './choices.js'

export default function forEachOp(
  baseList: unknown[],
  listName: string,
  useWords: boolean,
): {
  prompt: string
  question: string
  expected: string
  type: 'list'
  list: unknown[]
  op: string
  variant: string
  choices: unknown[]
  filterDescription: string | null
} {
  const workingList = [...baseList]
  const listLiteral = formatList(workingList)
  let prompt: string
  let filtered = workingList
  let filterDescription: string | null = null
  if (!useWords) {
    const numbersOnly = workingList.filter((v) => typeof v === 'number')
    if (numbersOnly.length > 0) {
      const minVal = Math.min(...(numbersOnly as number[]))
      const maxVal = Math.max(...(numbersOnly as number[]))
      const numericMode = Math.random()
      if (numericMode < 0.33) {
        const threshold = minVal + Math.floor(Math.random() * 4)
        prompt = `${listName} = ${listLiteral}\nfor num in ${listName}:\n    if num > ${threshold}:\n        print(num)`
        filtered = numbersOnly.filter((num) => (num as number) > threshold)
        filterDescription = `The if statement filters numbers greater than ${threshold}.`
      } else if (numericMode < 0.66) {
        const threshold = maxVal - Math.floor(Math.random() * 4)
        prompt = `${listName} = ${listLiteral}\nfor num in ${listName}:\n    if num < ${threshold}:\n        print(num)`
        filtered = numbersOnly.filter((num) => (num as number) < threshold)
        filterDescription = `The if statement filters numbers less than ${threshold}.`
      } else {
        const divisor = Math.floor(Math.random() * 3) + 2
        prompt = `${listName} = ${listLiteral}\nfor num in ${listName}:\n    if num % ${divisor} == 0:\n        print(num)`
        filtered = numbersOnly.filter((num) => (num as number) % divisor === 0)
        filterDescription = `The if statement filters numbers divisible by ${divisor}.`
      }
    }
  } else if (useWords) {
    const stringMode = Math.random()
    if (stringMode < 0.25) {
      const minLength = Math.floor(Math.random() * 3) + 4
      prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if len(word) >= ${minLength}:\n        print(word)`
      filtered = workingList.filter((word) => String(word).length >= minLength)
      filterDescription = `The if statement filters words with length at least ${minLength}.`
    } else if (stringMode < 0.5) {
      const maxLength = Math.floor(Math.random() * 3) + 3
      prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if len(word) <= ${maxLength}:\n        print(word)`
      filtered = workingList.filter((word) => String(word).length <= maxLength)
      filterDescription = `The if statement filters words with length at most ${maxLength}.`
    } else if (stringMode < 0.75) {
      const letter = String.fromCharCode(97 + Math.floor(Math.random() * 26))
      prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if '${letter}' in word:\n        print(word)`
      filtered = workingList.filter((word) => String(word).toLowerCase().includes(letter))
      filterDescription = `The if statement filters words containing '${letter}'.`
    } else {
      const letter = String.fromCharCode(97 + Math.floor(Math.random() * 26))
      prompt = `${listName} = ${listLiteral}\nfor word in ${listName}:\n    if word.startswith('${letter}'):\n        print(word)`
      filtered = workingList.filter((word) => String(word).toLowerCase().startsWith(letter))
      filterDescription = `The if statement filters words starting with '${letter}'.`
    }
  }
  if (filtered.length === 0) {
    prompt = `${listName} = ${listLiteral}\nfor item in ${listName}:\n    print(item)`
    filtered = workingList
    filterDescription = 'This loop prints every item because there is no filtering condition.'
  }
  return {
    prompt: prompt!,
    question: 'What values are printed?',
    expected: filtered.map(String).join(','),
    type: 'list',
    list: workingList,
    op: 'for-each',
    variant: 'value-selection',
    choices: buildListFinalChoices(workingList, useWords, null, null, Math.min(workingList.length + 4, 12)),
    filterDescription,
  }
}
