import crypto from 'crypto'
import type {
  HostedFragmentRecord,
  PassageDefinition,
  StudentRecord,
  StudentTemplate,
} from '../wwwSimTypes.js'

type RandomFn = () => number

const defaultAdjectives = ['strange', 'bright', 'quick']
const defaultNouns = ['thing', 'signal', 'object']

function pickRandom<T>(values: T[], random: RandomFn): T {
  return values[Math.floor(random() * values.length)] as T
}

function resolveNamePools(passage: PassageDefinition | undefined): { adjectives: string[]; nouns: string[] } {
  const candidateAdjectives = passage?.adjectives
  const candidateNouns = passage?.nouns
  const adjectives = Array.isArray(candidateAdjectives) && candidateAdjectives.length > 0 ? candidateAdjectives : defaultAdjectives
  const nouns = Array.isArray(candidateNouns) && candidateNouns.length > 0 ? candidateNouns : defaultNouns
  return { adjectives, nouns }
}

export function verifyHostname(hostname: string): boolean {
  const hostnameRegex = /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
  return hostnameRegex.test(hostname.trim().toLowerCase())
}

export function dividePassage(passage: string, parts = 5): string[] {
  const words = passage.split(/\s+/)
  const size = Math.ceil(words.length / parts)
  const fragments: string[] = []
  for (let index = 0; index < parts; index += 1) {
    fragments.push(words.slice(index * size, (index + 1) * size).join(' '))
  }
  return fragments
}

export function getRandomName(passage: PassageDefinition | undefined, random: RandomFn = Math.random): string {
  const { adjectives, nouns } = resolveNamePools(passage)
  return `${pickRandom(adjectives, random)}-${pickRandom(nouns, random)}`
}

export function getRandomUnusedName(
  used: string[],
  passage: PassageDefinition | undefined,
  random: RandomFn = Math.random,
): string {
  const usedSet = new Set(used)
  const { adjectives, nouns } = resolveNamePools(passage)
  const collisionThreshold = Math.max(adjectives.length * nouns.length * 2, 16)

  for (let attempt = 0; attempt < collisionThreshold; attempt += 1) {
    const generated = `${pickRandom(adjectives, random)}-${pickRandom(nouns, random)}`
    if (!usedSet.has(generated)) {
      return generated
    }
  }

  const fallbackRoot = `${adjectives[0] ?? defaultAdjectives[0]}-${nouns[0] ?? defaultNouns[0]}`
  if (!usedSet.has(fallbackRoot)) {
    return fallbackRoot
  }

  let suffix = 1
  let fallback = `${fallbackRoot}-${suffix}`
  while (usedSet.has(fallback)) {
    suffix += 1
    fallback = `${fallbackRoot}-${suffix}`
  }

  return fallback
}

export function createHash(fragment: string): string {
  return crypto.createHash('sha256').update(fragment).digest('hex')
}

export function createHostingMap(
  students: StudentRecord[],
  passage: PassageDefinition,
  random: RandomFn = Math.random,
): HostedFragmentRecord[] {
  if (students.length === 0) {
    return []
  }

  const fragments = dividePassage(passage.value)
  const studentHostingMap: Record<string, string[]> = {}
  const fragmentHostingMap: HostedFragmentRecord[] = []

  for (const student of students) {
    studentHostingMap[student.hostname] = []
  }

  fragments.forEach((fragment, index) => {
    const student = pickRandom(students, random)
    const studentFiles = studentHostingMap[student.hostname] ?? []
    const fileName = getRandomUnusedName(studentFiles, passage, random)
    studentFiles.push(fileName)
    studentHostingMap[student.hostname] = studentFiles

    fragmentHostingMap.push({
      fragment,
      index,
      assignedTo: [{ hostname: student.hostname, fileName }],
      hash: createHash(fragment),
    })
  })

  for (const student of students) {
    const { hostname } = student
    const hostedNames = studentHostingMap[hostname] ?? []
    while (hostedNames.length < 3) {
      const randomFragmentIndex = Math.floor(random() * fragments.length)
      const fragmentRecord = fragmentHostingMap[randomFragmentIndex]
      if (!fragmentRecord) break

      if (fragmentRecord.assignedTo.some((assignment) => assignment.hostname === hostname)) continue

      const fileName = getRandomUnusedName(hostedNames, passage, random)
      hostedNames.push(fileName)
      fragmentRecord.assignedTo.push({ hostname, fileName })
    }
  }

  return fragmentHostingMap
}

export function generateHtmlTemplate(
  hostname: string,
  fragmentRecords: HostedFragmentRecord[],
  title?: string,
  random: RandomFn = Math.random,
): StudentTemplate {
  const fragmentUrls = fragmentRecords
    .map((record) => {
      const firstSource = record.assignedTo[0]
      if (!firstSource) {
        return null
      }

      let source = firstSource
      if (record.assignedTo.length > 1) {
        const alternates = record.assignedTo.filter((assignment) => assignment.hostname !== hostname)
        if (alternates.length > 0) {
          source = pickRandom(alternates, random)
        }
      }

      return { hash: record.hash, url: `http://${source.hostname}/${source.fileName}` }
    })
    .filter((fragment): fragment is { hash: string; url: string } => Boolean(fragment))

  return { title, fragments: fragmentUrls }
}
