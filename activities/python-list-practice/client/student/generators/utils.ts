import { WORD_LISTS, NUMBER_LIST_NAMES, WORD_LIST_NAMES } from './pools.js'

export function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function generateNumberList(minLen = 4, maxLen = 6): number[] {
  const range = Math.max(0, maxLen - minLen)
  const length = Math.floor(Math.random() * (range + 1)) + minLen
  const start = Math.floor(Math.random() * 20) - 10
  const step = Math.random() < 0.5 ? 1 : Math.floor(Math.random() * 3) + 2
  const ascending = Math.random() < 0.5
  const list: number[] = []
  for (let i = 0; i < length; i += 1) {
    const value = start + (ascending ? i : -i) * step + Math.floor(Math.random() * 3)
    list.push(value)
  }
  return list
}

export function buildWordList(length: number): string[] {
  const base = [...randomItem(WORD_LISTS)]
  const pool: string[] = [...base]
  const allWords: string[] = WORD_LISTS.flat()
  while (pool.length < length) {
    const item = randomItem(allWords)
    pool.push(item)
  }
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, length)
}

export function randomListName(useWords: boolean): string {
  const listNames: string[] = useWords ? [...WORD_LIST_NAMES] : [...NUMBER_LIST_NAMES]
  return randomItem(listNames)!
}

export function sanitizeName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim().slice(0, 50)
  if (trimmed) return trimmed
  return null
}
