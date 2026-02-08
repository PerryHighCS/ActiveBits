// Challenge generation utilities for Python List Practice
import { WORD_LISTS } from './generators/pools.js'
import {
  randomItem,
  generateNumberList,
  randomListName,
  sanitizeName,
} from './generators/utils.js'
import {
  formatForRangeDetail,
  formatRangeLenDetail,
} from './generators/formatters.js'
import indexGet from './generators/indexGet.js'
import indexSet from './generators/indexSet.js'
import lenOp from './generators/len.js'
import appendOp from './generators/append.js'
import removeOp from './generators/remove.js'
import insertOp from './generators/insert.js'
import popOp from './generators/pop.js'
import forRangeOp from './generators/forRange.js'
import rangeLenOp from './generators/rangeLen.js'
import forEachOp from './generators/forEach.js'

export const OPERATIONS = [
  'index-get',
  'index-set',
  'len',
  'append',
  'remove',
  'insert',
  'pop',
  'for-range',
  'range-len',
  'for-each',
] as const

export type QuestionOperation = (typeof OPERATIONS)[number]

export const QUESTION_LABELS: Record<QuestionOperation | 'all', string> = {
  'index-get': 'Index (read)',
  'index-set': 'Index (write)',
  len: 'len(list)',
  append: 'append()',
  remove: 'remove()',
  insert: 'insert()',
  pop: 'pop()',
  'for-range': 'for range loop',
  'range-len': 'range(len(list))',
  'for-each': 'for each loop',
  all: 'All question types',
}

interface Challenge extends Record<string, unknown> {
  op: QuestionOperation
  prompt: string
  question: string
  expected: string
  type?: string
  list?: unknown[]
}

const HINT_DEFINITIONS: Record<QuestionOperation, string> = {
  'index-get':
    'Use list[index] to read the value at that position. Remember that indexes start at 0.',
  'index-set':
    'Assign with list[index] = value to replace the element stored at that index.',
  len: 'len(list) returns how many items are currently stored in the list.',
  append: 'append(value) adds the value to the end of the list and increases the length by 1.',
  remove:
    'remove(value) searches for the first matching value and deletes it. The remaining items shift left.',
  insert:
    'insert(index, value) places the value at the given index and shifts everything at or after that index to the right.',
  pop: 'pop() removes and returns the last item. pop(index) removes and returns the item at that index and shifts every later element left.',
  'for-range': 'A for range loop runs once for every number produced by range(start, stop, step).',
  'range-len':
    'range(len(list)) produces valid indexes for the list (optionally starting somewhere else or skipping with a step).',
  'for-each': 'A for-each loop walks through each item in the list one value at a time.',
}

export function getHintDefinition(challenge?: Challenge | null): string {
  if (!challenge)
    return 'Look closely at the code to understand what each line is doing.'
  return (
    HINT_DEFINITIONS[challenge.op as QuestionOperation] ||
    'Read the code carefully and trace what it does to the list.'
  )
}

export function buildAnswerDetails(challenge?: Challenge | null): string[] {
  if (!challenge) return []
  const details: string[] = []
  if ((challenge as any).filterDescription) {
    details.push((challenge as any).filterDescription)
  }
  if ((challenge as any).doubleLoopInfo) {
    ;(challenge as any).doubleLoopInfo.loops.forEach((loop: any, idx: number) => {
      const label =
        (challenge as any).doubleLoopInfo.loops.length > 1
          ? `Loop ${idx + 1}`
          : 'This loop'
      const detail =
        loop.type === 'range-len'
          ? formatRangeLenDetail(label, loop)
          : formatForRangeDetail(label, loop.start, loop.stop, loop.step)
      const printer =
        loop.prints === 'value'
          ? 'It prints the list value at that index.'
          : loop.prints === 'index'
            ? 'It prints the index number itself.'
            : 'It prints the loop variable.'
      details.push(`${detail} ${printer}`)
    })
  } else if (
    challenge.op === 'for-range' &&
    typeof (challenge as any).start === 'number'
  ) {
    details.push(
      formatForRangeDetail(
        'This loop',
        (challenge as any).start,
        (challenge as any).stop,
        (challenge as any).step,
      ),
    )
  } else if ((challenge as any).rangeLenInfo) {
    details.push(
      formatRangeLenDetail('This loop', (challenge as any).rangeLenInfo),
    )
  }
  if ((challenge as any).needsDuplicate) {
    details.push(
      'remove(value) only deletes the first matching value, so later duplicates stay in the list.',
    )
  }
  return details
}

function generateChallenge(
  allowedTypesSet: Set<string> = new Set(['all']),
): Challenge {
  const useWords = Math.random() < 0.5
  const baseList = useWords ? [...randomItem(WORD_LISTS)] : generateNumberList()
  const listName = randomListName(useWords)
  const typeSet = allowedTypesSet instanceof Set ? allowedTypesSet : new Set(allowedTypesSet || [])
  const availableOps = typeSet.has('all')
    ? OPERATIONS
    : OPERATIONS.filter((operation) => typeSet.has(operation))
  const opPool: string[] = availableOps.length > 0 ? [...availableOps] : [...OPERATIONS]
  const op = randomItem(opPool)

  const opMap: Record<QuestionOperation, (baseList: unknown[], listName: string, useWords: boolean) => Challenge> = {
    'index-get': indexGet as any,
    'index-set': indexSet as any,
    len: lenOp as any,
    append: appendOp as any,
    remove: removeOp as any,
    insert: insertOp as any,
    pop: popOp as any,
    'for-range': forRangeOp as any,
    'range-len': rangeLenOp as any,
    'for-each': forEachOp as any,
  }

  const generator = opMap[op as QuestionOperation] || (forEachOp as any)
  return generator(baseList, listName, useWords)
}

export function createChallengeForTypes(
  typeSet: Set<string> | string[] | null | undefined,
): Challenge {
  let normalized: Set<string>
  if (typeSet instanceof Set) {
    normalized = new Set(typeSet)
  } else if (Array.isArray(typeSet)) {
    normalized = new Set(typeSet)
  } else {
    normalized = new Set(['all'])
  }
  const guardSet = normalized.has('all') ? null : normalized
  for (let i = 0; i < 10; i += 1) {
    const candidate = generateChallenge(normalized)
    if (!guardSet || guardSet.has(candidate.op)) {
      return candidate
    }
  }
  return generateChallenge(new Set(['all']))
}

export { sanitizeName }
