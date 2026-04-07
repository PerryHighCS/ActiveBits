import type { AnswerPayload, MCQOption, MCQQuestion, MCQSelectionMode } from './types.js'

export function getCorrectOptionIds(
  options: readonly Pick<MCQOption, 'id' | 'isCorrect'>[],
): string[] {
  return options
    .filter((option) => option.isCorrect === true)
    .map((option) => option.id)
}

export function getMcqSelectionMode(question: Pick<MCQQuestion, 'options'>): MCQSelectionMode {
  return getCorrectOptionIds(question.options).length > 1 ? 'multiple' : 'single'
}

export function getAnswerSelectedOptionIds(answer: AnswerPayload): string[] {
  return answer.type === 'multiple-choice' ? answer.selectedOptionIds : []
}

export function areMcqSelectionsEqual(
  leftSelectedOptionIds: readonly string[],
  rightSelectedOptionIds: readonly string[],
): boolean {
  if (leftSelectedOptionIds.length !== rightSelectedOptionIds.length) {
    return false
  }

  const leftSet = new Set(leftSelectedOptionIds)
  if (leftSet.size !== leftSelectedOptionIds.length || leftSet.size !== rightSelectedOptionIds.length) {
    return false
  }

  return rightSelectedOptionIds.every((optionId) => leftSet.has(optionId))
}

export function isMcqAnswerCorrect(
  selectedOptionIds: readonly string[],
  correctOptionIds: readonly string[],
): boolean {
  if (correctOptionIds.length === 0) {
    return false
  }

  const selectedSet = new Set(selectedOptionIds)
  if (selectedSet.size !== selectedOptionIds.length || selectedSet.size !== correctOptionIds.length) {
    return false
  }

  return correctOptionIds.every((optionId) => selectedSet.has(optionId))
}
