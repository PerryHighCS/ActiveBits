import { getMcqSelectionMode } from './mcq.js'
import { MAX_MCQ_OPTIONS, type AnswerPayload, type MCQOption, type MCQQuestion, type Question, type QuestionType } from './types.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function normalizeId(value: unknown): string | null {
  const s = normalizeString(value, 128)
  if (!s) return null
  return /^[\w-]+$/.test(s) ? s : null
}

const MAX_QUESTION_SET_SIZE = 100

type RandomSource = () => number
type ShufflableOption = Pick<MCQOption, 'text' | 'isCorrect'>

// ---------------------------------------------------------------------------
// Question validation
// ---------------------------------------------------------------------------

function validateMCQOption(raw: unknown, index: number): { option: MCQOption | null; error: string | null } {
  if (!isRecord(raw)) {
    return { option: null, error: `option[${index}] must be an object` }
  }
  const id = normalizeId(raw.id)
  if (!id) {
    return { option: null, error: `option[${index}].id must be a non-empty alphanumeric, underscore, or hyphen string` }
  }
  const text = normalizeString(raw.text, 500)
  if (!text) {
    return { option: null, error: `option[${index}].text must be non-empty` }
  }
  const isCorrect =
    raw.isCorrect === undefined || raw.isCorrect === null
      ? undefined
      : typeof raw.isCorrect === 'boolean'
        ? raw.isCorrect
        : null

  if (isCorrect === null) {
    return {
      option: null,
      error: `option[${index}].isCorrect must be boolean when provided`,
    }
  }

  return {
    option: { id, text, ...(isCorrect !== undefined ? { isCorrect } : {}) },
    error: null,
  }
}

function validateMCQQuestion(raw: Record<string, unknown>, id: string, text: string, order: number, errors: string[]): MCQQuestion | null {
  if (!Array.isArray(raw.options) || raw.options.length < 2) {
    errors.push(`question "${id}": multiple-choice must have at least 2 options`)
    return null
  }
  if (raw.options.length > MAX_MCQ_OPTIONS) {
    errors.push(`question "${id}": multiple-choice may have at most ${MAX_MCQ_OPTIONS} options`)
    return null
  }

  const options: MCQOption[] = []
  for (let i = 0; i < raw.options.length; i++) {
    const { option, error } = validateMCQOption(raw.options[i], i)
    if (error || option === null) {
      errors.push(`question "${id}": ${error}`)
      return null
    }
    options.push(option)
  }

  const ids = options.map((o) => o.id)
  if (new Set(ids).size !== ids.length) {
    errors.push(`question "${id}": option ids must be unique`)
    return null
  }

  const responseTimeLimitMs = parseTimeLimitMs(raw.responseTimeLimitMs)

  return {
    id,
    type: 'multiple-choice',
    text,
    order,
    options,
    ...(responseTimeLimitMs !== undefined ? { responseTimeLimitMs } : {}),
  }
}

function parseTimeLimitMs(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return undefined
  if (value === 0 || value === false) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value)
}

/**
 * Validates a single question object from untrusted input.
 * Returns the normalized question or null, and pushes any errors into the array.
 */
export function validateQuestion(raw: unknown, errors: string[]): Question | null {
  if (!isRecord(raw)) {
    errors.push('question must be an object')
    return null
  }

  const id = normalizeId(raw.id)
  if (!id) {
    errors.push('question.id must be a non-empty alphanumeric, underscore, or hyphen string')
    return null
  }
  const text = normalizeString(raw.text, 1000)
  if (!text) {
    errors.push(`question "${id}": text must be non-empty`)
    return null
  }

  const rawType = raw.type
  const validTypes: QuestionType[] = ['free-response', 'multiple-choice']
  if (!validTypes.includes(rawType as QuestionType)) {
    errors.push(`question "${id}": type must be "free-response" or "multiple-choice"`)
    return null
  }
  const type = rawType as QuestionType

  const rawOrder = raw.order
  const order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? Math.round(rawOrder) : 0

  const responseTimeLimitMs = parseTimeLimitMs(raw.responseTimeLimitMs)

  if (type === 'free-response') {
    return {
      id,
      type: 'free-response',
      text,
      order,
      ...(responseTimeLimitMs !== undefined ? { responseTimeLimitMs } : {}),
    }
  }

  return validateMCQQuestion(raw, id, text, order, errors)
}

/**
 * Validates an array of question objects from untrusted input (e.g. JSON import).
 * Returns valid questions and an array of error messages.
 */
export function validateQuestionSet(raw: unknown): { questions: Question[]; errors: string[] } {
  const errors: string[] = []

  if (!Array.isArray(raw)) {
    return { questions: [], errors: ['question set must be an array'] }
  }
  if (raw.length === 0) {
    return { questions: [], errors: ['question set must not be empty'] }
  }
  if (raw.length > MAX_QUESTION_SET_SIZE) {
    return { questions: [], errors: [`question set may contain at most ${MAX_QUESTION_SET_SIZE} questions`] }
  }

  const questions: Question[] = []
  for (const item of raw) {
    const q = validateQuestion(item, errors)
    if (q) questions.push(q)
  }

  const ids = questions.map((q) => q.id)
  if (new Set(ids).size !== ids.length) {
    errors.push('question ids must be unique within a set')
    return { questions: [], errors }
  }

  return { questions, errors }
}

// ---------------------------------------------------------------------------
// Gimkit CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parses a Gimkit-compatible CSV string into a question set.
 *
 * Format:
 *   Row 1: single title cell (ignored)
 *   Row 2: "Question","Correct Answer","Incorrect Answer 1","Incorrect Answer 2 (Optional)","Incorrect Answer 3 (Optional)"
 *   Row 3+: one question per row
 *
 * Resonance treats Gimkit CSV as a compatibility format for single-correct
 * multiple-choice questions only.
 */
export function parseGimkitCSV(content: string): { questions: Question[]; errors: string[] } {
  return parseGimkitCSVWithRandom(content, Math.random)
}

/**
 * Test seam for Gimkit CSV parsing that allows deterministic answer shuffling.
 * Production callers should use `parseGimkitCSV`, which injects `Math.random`.
 *
 * `random` must behave like `Math.random`, returning a finite number in the
 * range `[0, 1)`. Values outside that contract throw so invalid injected
 * PRNGs fail fast instead of corrupting the shuffle.
 */
export function parseGimkitCSVWithRandom(
  content: string,
  random: RandomSource,
): { questions: Question[]; errors: string[] } {
  const errors: string[] = []
  const lines = splitCSVLines(content)

  if (lines.length < 3) {
    return { questions: [], errors: ['CSV must have at least a header row and one question'] }
  }

  // Skip row 0 (title) and row 1 (column headers)
  const dataLines = lines.slice(2)
  const questions: Question[] = []
  let orderCounter = 0

  for (let lineIndex = 0; lineIndex < dataLines.length; lineIndex++) {
    const rowNumber = lineIndex + 3
    const cells = parseCSVRow(dataLines[lineIndex] ?? '')
    if (cells.length === 0 || cells.every((c) => c.trim() === '')) continue

    const questionText = cells[0]?.trim() ?? ''
    const correctAnswer = cells[1]?.trim() ?? ''
    const incorrectAnswers = cells.slice(2).map((c) => c.trim()).filter(Boolean)

    if (!questionText) {
      errors.push(`Row ${rowNumber}: question text is required`)
      continue
    }
    if (!correctAnswer) {
      errors.push(`Row ${rowNumber}: Gimkit CSV requires a correct answer for multiple-choice questions`)
      continue
    }
    if (incorrectAnswers.length === 0) {
      errors.push(`Row ${rowNumber}: Gimkit CSV requires at least one incorrect answer for multiple-choice questions`)
      continue
    }
    if (incorrectAnswers.length > 3) {
      errors.push(`Row ${rowNumber}: Gimkit CSV supports at most 3 incorrect answers`)
      continue
    }

    const id = `q${orderCounter + 1}`
    const allAnswers = shuffleOptions(
      [
        { text: correctAnswer, isCorrect: true },
        ...incorrectAnswers.map((text) => ({ text })),
      ],
      random,
    ).map((option, optionIndex) => ({
      id: `${id}_o${optionIndex + 1}`,
      text: option.text,
      ...(option.isCorrect === true ? { isCorrect: true } : {}),
    }))

    if (questions.length >= MAX_QUESTION_SET_SIZE) {
      errors.push(`question set may contain at most ${MAX_QUESTION_SET_SIZE} questions`)
      return { questions: [], errors }
    }
    questions.push({
      id,
      type: 'multiple-choice',
      text: questionText,
      order: orderCounter,
      options: allAnswers,
    })

    orderCounter++
  }

  if (questions.length === 0 && errors.length === 0) {
    errors.push('CSV contained no valid questions')
  }

  if (questions.length === 0) {
    return { questions: [], errors }
  }

  const validated = validateQuestionSet(questions)
  return {
    questions: validated.questions,
    errors: [...errors, ...validated.errors],
  }
}

function shuffleOptions(options: ShufflableOption[], random: RandomSource): ShufflableOption[] {
  const shuffled = [...options]

  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomValue = random()
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new Error(`parseGimkitCSVWithRandom expected random() to return a finite value in [0, 1), received: ${String(randomValue)}`)
    }
    const swapIndex = Math.floor(randomValue * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!]
  }

  return shuffled
}

function splitCSVLines(content: string): string[] {
  // Split on newlines but respect quoted fields containing newlines
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && content[i + 1] === '\n') i++
      lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) lines.push(current)
  return lines
}

function parseCSVRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

// ---------------------------------------------------------------------------
// Student registration validation
// ---------------------------------------------------------------------------

/** Max character length for a student display name. */
const MAX_NAME_LENGTH = 80

/**
 * Validates and normalizes a student registration request body.
 */
export function validateStudentRegistration(body: unknown): { name: string } | null {
  if (!isRecord(body)) return null
  const name = normalizeString(body.name, MAX_NAME_LENGTH)
  if (!name) return null
  return { name }
}

// ---------------------------------------------------------------------------
// Answer payload validation
// ---------------------------------------------------------------------------

/**
 * Validates an answer submission payload against the target question.
 * Returns the normalized AnswerPayload or null if invalid.
 */
export function validateAnswerPayload(body: unknown, question: Question): AnswerPayload | null {
  if (!isRecord(body)) return null

  if (question.type === 'free-response') {
    const text = normalizeString(body.text, 2000)
    if (!text) return null
    return { type: 'free-response', text }
  }

  if (question.type === 'multiple-choice') {
    const validOptionIds = question.options.map((o) => o.id)
    const rawSelectedOptionIds = Array.isArray(body.selectedOptionIds)
      ? body.selectedOptionIds
      : typeof body.selectedOptionId === 'string'
        ? [body.selectedOptionId]
        : null

    if (!rawSelectedOptionIds || rawSelectedOptionIds.length === 0) {
      return null
    }

    const normalizedSelectedOptionIds = rawSelectedOptionIds
      .map((optionId) => normalizeId(optionId))
      .filter((optionId): optionId is string => optionId !== null)

    if (normalizedSelectedOptionIds.length !== rawSelectedOptionIds.length) {
      return null
    }

    const uniqueSelectedOptionIds = Array.from(new Set(normalizedSelectedOptionIds))
    if (uniqueSelectedOptionIds.length !== normalizedSelectedOptionIds.length) {
      return null
    }

    if (uniqueSelectedOptionIds.some((optionId) => !validOptionIds.includes(optionId))) {
      return null
    }

    if (getMcqSelectionMode(question) === 'single' && uniqueSelectedOptionIds.length !== 1) {
      return null
    }

    return { type: 'multiple-choice', selectedOptionIds: uniqueSelectedOptionIds }
  }

  return null
}
