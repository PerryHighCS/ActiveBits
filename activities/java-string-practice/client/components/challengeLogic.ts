import type {
  CompareToChallenge,
  EqualsChallenge,
  IndexOfChallenge,
  JavaStringAnswer,
  JavaStringChallenge,
  JavaStringMethodId,
  LengthChallenge,
  SubstringChallenge,
} from '../../javaStringPracticeTypes.js'

const sampleStrings = [
  'Hello World',
  'Java Programming',
  'String Methods',
  'Computer Science',
  'Learning Code',
  'Practice Makes Perfect',
  'Object Oriented',
  'Data Structures',
  'Algorithm Design',
  'Software Development',
  'Programming Language',
  'Code Challenge',
  'Method Overloading',
  'Class Inheritance',
  'Variable Declaration',
  'Loop Iteration',
  'Array Processing',
  'Exception Handling',
  'Memory Management',
  'Database Connection',
  'User Interface',
  'System Architecture',
  'Network Protocol',
  'File Operations',
  'String Manipulation',
  'Boolean Logic',
  'Integer Values',
  'Character Arrays',
  'Method Parameters',
  'Return Statement',
]

const challengeHints: Record<Exclude<JavaStringMethodId, 'all'>, string> = {
  substring:
    'Remember: substring(start) goes to end of string, substring(start, end) goes up to (but not including) end index',
  indexOf:
    'Remember: indexOf(substring) searches from beginning, indexOf(substring, start) searches from start index. Returns -1 if not found',
  equals:
    'Remember: equals() compares the actual content of strings. It is case-sensitive and returns true or false',
  length: 'Remember: length() returns the number of characters in the string, including spaces and special characters',
  compareTo:
    'Remember: compareTo() returns 0 if strings are equal, negative if first string comes before second alphabetically, positive if after',
}

const challengeTypes: Array<Exclude<JavaStringMethodId, 'all'>> = [
  'substring',
  'indexOf',
  'equals',
  'length',
  'compareTo',
]

function pickRandom<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)] as T
}

/**
 * Generate a new challenge based on selected types.
 */
export function generateChallenge(selectedTypes: Set<JavaStringMethodId>): JavaStringChallenge {
  const availableTypes = selectedTypes.has('all')
    ? challengeTypes
    : challengeTypes.filter((type) => selectedTypes.has(type))

  const randomType = pickRandom(availableTypes.length > 0 ? availableTypes : challengeTypes)

  switch (randomType) {
    case 'substring':
      return generateSubstringChallenge()
    case 'indexOf':
      return generateIndexOfChallenge()
    case 'equals':
      return generateEqualsChallenge()
    case 'length':
      return generateLengthChallenge()
    case 'compareTo':
      return generateCompareToChallenge()
    default:
      return generateSubstringChallenge()
  }
}

function generateSubstringChallenge(): SubstringChallenge {
  const text = pickRandom(sampleStrings)
  const varNames = [
    'text',
    'str',
    'message',
    'word',
    'sentence',
    'data',
    'input',
    'content',
    'value',
    'line',
    'phrase',
    'title',
  ]
  const varName = pickRandom(varNames)

  if (text.length < 3) {
    return generateSubstringChallenge()
  }

  if (Math.random() < 0.5) {
    const maxStart = text.length - 1
    const start = Math.floor(Math.random() * maxStart)
    return {
      type: 'substring',
      hint: challengeHints.substring,
      text,
      varName,
      start,
      expectedAnswer: text.substring(start),
      question: `What will <code>${varName}.substring(${start})</code> return?`,
      methodType: '1-parameter',
    }
  }

  const maxStart = text.length - 2
  const start = Math.floor(Math.random() * (maxStart + 1))
  const minEnd = start + 1
  const maxEnd = text.length
  const end = minEnd + Math.floor(Math.random() * (maxEnd - minEnd + 1))

  return {
    type: 'substring',
    hint: challengeHints.substring,
    text,
    varName,
    start,
    end,
    expectedAnswer: text.substring(start, end),
    question: `What will <code>${varName}.substring(${start}, ${end})</code> return?`,
    methodType: '2-parameter',
  }
}

function generateIndexOfChallenge(): IndexOfChallenge {
  const text = pickRandom(sampleStrings)
  const varNames = [
    'text',
    'str',
    'message',
    'word',
    'sentence',
    'data',
    'input',
    'content',
    'value',
    'line',
    'phrase',
    'title',
  ]
  const varName = pickRandom(varNames)

  const notFoundTerms = [
    'z',
    'q',
    'x',
    'Z',
    'Q',
    'X',
    'the',
    'and',
    'for',
    'with',
    'code',
    'test',
    '123',
    '!',
    '@',
    '#',
    '?',
    '.',
    'ing',
    'tion',
    'ment',
    'ness',
  ]

  const generateNotFoundTerm = (): string => {
    let searchTerm = pickRandom(notFoundTerms)
    let attempts = 0

    if (Math.random() < 0.5 && text.length > 3) {
      const words = text.split(' ').filter((word) => word.length > 0)
      const chars = text.split('').filter((char) => char !== ' ' && char.length > 0)

      if (words.length > 0 && Math.random() < 0.7) {
        const word = pickRandom(words)
        const changeType = Math.random()
        if (changeType < 0.33) {
          searchTerm = word.toUpperCase()
        } else if (changeType < 0.66) {
          searchTerm = word.toLowerCase()
        } else {
          searchTerm =
            word.charAt(0) === word.charAt(0).toUpperCase()
              ? word.charAt(0).toLowerCase() + word.slice(1)
              : word.charAt(0).toUpperCase() + word.slice(1)
        }
      } else if (chars.length > 0) {
        const char = pickRandom(chars)
        searchTerm = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()
      }

      if (text.indexOf(searchTerm) !== -1) {
        searchTerm = pickRandom(notFoundTerms)
      }
    }

    do {
      if (text.indexOf(searchTerm) === -1) break
      searchTerm = pickRandom(notFoundTerms)
      attempts += 1
    } while (attempts < 20)

    return searchTerm
  }

  if (Math.random() < 0.6) {
    let searchTerm: string
    let expectedAnswer: number

    if (Math.random() < 0.7) {
      const words = text.split(' ').filter((word) => word.length > 0)
      const chars = [...new Set(text.split(''))].filter((char) => char !== ' ')
      const options = [...words, ...chars]
      searchTerm = options.length ? pickRandom(options) : text.charAt(0)
      expectedAnswer = text.indexOf(searchTerm)
    } else {
      searchTerm = generateNotFoundTerm()
      expectedAnswer = -1
    }

    return {
      type: 'indexOf',
      hint: challengeHints.indexOf,
      text,
      varName,
      searchTerm,
      expectedAnswer,
      question: `What will <code>${varName}.indexOf("${searchTerm}")</code> return?`,
      methodType: '1-parameter',
    }
  }

  let searchTerm: string
  let startIndex: number
  let expectedAnswer: number

  if (Math.random() < 0.7) {
    const chars = [...new Set(text.split(''))].filter((char) => char !== ' ')
    searchTerm = chars.length ? pickRandom(chars) : text.charAt(0)
    startIndex = 0

    const occurrences: number[] = []
    for (let index = 0; index < text.length; index += 1) {
      if (text.indexOf(searchTerm, index) === index) {
        occurrences.push(index)
      }
    }

    if (occurrences.length > 0 && Math.random() < 0.6) {
      const targetOccurrence = pickRandom(occurrences)
      startIndex = Math.floor(Math.random() * (targetOccurrence + 1))
      expectedAnswer = text.indexOf(searchTerm, startIndex)
    } else if (occurrences.length > 0) {
      startIndex = (occurrences[occurrences.length - 1] ?? 0) + 1
      expectedAnswer = text.indexOf(searchTerm, startIndex)
    } else {
      expectedAnswer = text.indexOf(searchTerm, startIndex)
    }
  } else {
    searchTerm = generateNotFoundTerm()
    startIndex = Math.floor(Math.random() * Math.max(1, text.length - 1))
    expectedAnswer = -1
  }

  return {
    type: 'indexOf',
    hint: challengeHints.indexOf,
    text,
    varName,
    searchTerm,
    startIndex,
    expectedAnswer,
    question: `What will <code>${varName}.indexOf("${searchTerm}", ${startIndex})</code> return?`,
    methodType: '2-parameter',
  }
}

function generateEqualsChallenge(): EqualsChallenge {
  const strings = [
    'Hello',
    'hello',
    'HELLO',
    'Hello World',
    'hello world',
    'Java',
    'java',
    'JAVA',
    'Programming',
    'programming',
    'Code',
    'code',
    'String',
    'string',
    'Method',
    'method',
    'Class',
    'class',
    'Object',
    'object',
    'Array',
    'array',
  ]
  const varNames: Array<[string, string]> = [
    ['str1', 'str2'],
    ['name1', 'name2'],
    ['word1', 'word2'],
    ['text', 'other'],
    ['first', 'second'],
    ['left', 'right'],
    ['original', 'copy'],
    ['input', 'target'],
    ['source', 'dest'],
    ['userInput', 'expected'],
    ['message1', 'message2'],
    ['title', 'header'],
    ['itemA', 'itemB'],
    ['valueX', 'valueY'],
    ['dataOne', 'dataTwo'],
  ]

  const [var1, var2] = pickRandom(varNames)
  const text1 = pickRandom(strings)

  let text2 = text1
  let expectedAnswer = true
  if (Math.random() >= 0.4) {
    text2 = strings.find((value) => value !== text1 && value.toLowerCase() !== text1.toLowerCase()) || 'Different'
    expectedAnswer = false
  }

  const firstVarCallsMethod = Math.random() < 0.5
  const callingVar = firstVarCallsMethod ? var1 : var2
  const parameterVar = firstVarCallsMethod ? var2 : var1

  return {
    type: 'equals',
    hint: challengeHints.equals,
    text1,
    text2,
    var1,
    var2,
    callingVar,
    parameterVar,
    expectedAnswer,
    question: `What will <code>${callingVar}.equals(${parameterVar})</code> return?`,
  }
}

function generateLengthChallenge(): LengthChallenge {
  const strings = [
    '',
    'a',
    'Hi',
    'Java',
    'Hello',
    'Programming',
    'Hello World',
    'String Methods',
    'Computer Science',
    'a b c',
    '123',
    'Hello123',
    'Special!@#',
    'Multi Word String',
  ]
  const varNames = [
    'text',
    'str',
    'message',
    'word',
    'sentence',
    'data',
    'input',
    'content',
    'value',
    'line',
    'phrase',
    'title',
  ]
  const text = pickRandom(strings)
  const varName = pickRandom(varNames)

  return {
    type: 'length',
    hint: challengeHints.length,
    text,
    varName,
    expectedAnswer: text.length,
    question: `What will <code>${varName}.length()</code> return?`,
  }
}

function generateCompareToChallenge(): CompareToChallenge {
  const stringPairs: Array<[string, string]> = [
    ['apple', 'apple'],
    ['Java', 'Java'],
    ['hello', 'hello'],
    ['apple', 'banana'],
    ['cat', 'dog'],
    ['hello', 'world'],
    ['Java', 'Python'],
    ['abc', 'def'],
    ['banana', 'apple'],
    ['dog', 'cat'],
    ['world', 'hello'],
    ['Python', 'Java'],
    ['def', 'abc'],
    ['Apple', 'apple'],
    ['java', 'Java'],
    ['Hello', 'hello'],
  ]
  const varNames: Array<[string, string]> = [
    ['str1', 'str2'],
    ['name1', 'name2'],
    ['word1', 'word2'],
    ['text', 'other'],
    ['first', 'second'],
    ['left', 'right'],
    ['original', 'copy'],
    ['input', 'target'],
    ['source', 'dest'],
    ['userInput', 'expected'],
    ['message1', 'message2'],
    ['title', 'header'],
    ['itemA', 'itemB'],
    ['valueX', 'valueY'],
    ['dataOne', 'dataTwo'],
  ]

  const [var1, var2] = pickRandom(varNames)
  const [text1, text2] = pickRandom(stringPairs)

  const firstVarCallsMethod = Math.random() < 0.5
  const callingVar = firstVarCallsMethod ? var1 : var2
  const parameterVar = firstVarCallsMethod ? var2 : var1
  const callingText = firstVarCallsMethod ? text1 : text2
  const parameterText = firstVarCallsMethod ? text2 : text1

  let expectedAnswer: CompareToChallenge['expectedAnswer']
  if (callingText === parameterText) {
    expectedAnswer = 0
  } else if (callingText < parameterText) {
    expectedAnswer = 'negative'
  } else {
    expectedAnswer = 'positive'
  }

  return {
    type: 'compareTo',
    hint: challengeHints.compareTo,
    text1,
    text2,
    var1,
    var2,
    callingVar,
    parameterVar,
    callingText,
    parameterText,
    expectedAnswer,
    question: `What will <code>${callingVar}.compareTo(${parameterVar})</code> return?`,
  }
}

/**
 * Validate a user answer against the challenge.
 */
export function validateAnswer(challenge: JavaStringChallenge, userAnswer: JavaStringAnswer): boolean {
  if (challenge.type === 'equals') {
    return String(userAnswer).toLowerCase() === String(challenge.expectedAnswer).toLowerCase()
  }
  if (challenge.type === 'compareTo') {
    return String(userAnswer).toLowerCase().trim() === String(challenge.expectedAnswer).toLowerCase()
  }
  return String(userAnswer) === String(challenge.expectedAnswer)
}

/**
 * Return a user-friendly explanation for the correct answer.
 */
export function getExplanation(challenge: JavaStringChallenge): string {
  if (challenge.type === 'substring') {
    if (challenge.methodType === '1-parameter') {
      return `substring(${challenge.start}) extracts characters from index ${challenge.start} to the end of the string.`
    }
    return `substring(${challenge.start}, ${challenge.end}) extracts characters from index ${challenge.start} up to (but not including) index ${challenge.end}.`
  }

  if (challenge.type === 'indexOf') {
    if (challenge.expectedAnswer === -1) {
      return `"${challenge.searchTerm}" is not found in the string, so indexOf returns -1.`
    }
    return `"${challenge.searchTerm}" first appears at index ${challenge.expectedAnswer}.`
  }

  if (challenge.type === 'equals') {
    if (challenge.expectedAnswer) {
      return `"${challenge.text1}" and "${challenge.text2}" have exactly the same characters, so equals() returns true.`
    }
    return `"${challenge.text1}" and "${challenge.text2}" are different (equals() is case-sensitive), so equals() returns false.`
  }

  if (challenge.type === 'length') {
    return `The string "${challenge.text}" contains ${challenge.expectedAnswer} characters (including spaces).`
  }

  if (challenge.type === 'compareTo') {
    if (challenge.expectedAnswer === 0) {
      return `"${challenge.callingText}" and "${challenge.parameterText}" are identical, so compareTo() returns 0.`
    }
    if (challenge.expectedAnswer === 'negative') {
      return `"${challenge.callingText}" comes before "${challenge.parameterText}" alphabetically, so compareTo() returns a negative number.`
    }
    return `"${challenge.callingText}" comes after "${challenge.parameterText}" alphabetically, so compareTo() returns a positive number.`
  }

  return ''
}
