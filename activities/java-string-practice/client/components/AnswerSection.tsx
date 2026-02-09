import { useEffect, useRef } from 'react'
import Button from '@src/components/ui/Button'
import type { JavaStringAnswer, JavaStringChallenge } from '../../javaStringPracticeTypes.js'

interface AnswerSectionProps {
  challenge: JavaStringChallenge
  userAnswer: string
  selectedIndices: number[]
  onAnswerChange: (value: string) => void
  onSubmit: (answer: JavaStringAnswer) => void
}

/**
 * Mounting contract:
 * Render this component only while feedback/results are hidden for the current challenge.
 *
 * Keyboard shortcuts (global keydown listener):
 * - `Enter`: submit text/numeric answers when non-empty
 * - `T` / `F`: submit equals challenge answers
 * - `P` / `Z` / `N`: submit compareTo sign answers (positive/zero/negative)
 */
export default function AnswerSection({
  challenge,
  userAnswer,
  selectedIndices,
  onAnswerChange,
  onSubmit,
}: AnswerSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inputRef.current && (challenge.type === 'substring' || challenge.type === 'indexOf' || challenge.type === 'length')) {
      inputRef.current.focus()
    }
  }, [challenge])

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement && event.key !== 'Enter') {
        return
      }

      if (challenge.type === 'equals' && (event.key === 't' || event.key === 'T')) {
        event.preventDefault()
        onSubmit(true)
      } else if (challenge.type === 'equals' && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault()
        onSubmit(false)
      } else if (challenge.type === 'compareTo') {
        if (event.key === 'p' || event.key === 'P') {
          event.preventDefault()
          onSubmit('positive')
        } else if (event.key === 'z' || event.key === 'Z') {
          event.preventDefault()
          onSubmit(0)
        } else if (event.key === 'n' || event.key === 'N') {
          event.preventDefault()
          onSubmit('negative')
        }
      } else if (event.key === 'Enter' && userAnswer !== '') {
        event.preventDefault()
        onSubmit(userAnswer)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [challenge.type, onSubmit, userAnswer])

  if (challenge.type === 'equals') {
    return (
      <div className="answer-section">
        <div className="answer-buttons">
          <Button onClick={() => onSubmit(true)} className="answer-btn true-btn">
            True (T)
          </Button>
          <Button onClick={() => onSubmit(false)} className="answer-btn false-btn">
            False (F)
          </Button>
        </div>
      </div>
    )
  }

  if (challenge.type === 'compareTo') {
    return (
      <div className="answer-section">
        <div className="compareTo-hint">Choose the sign of the result:</div>
        <div className="answer-buttons compareTo-buttons">
          <Button onClick={() => onSubmit('positive')} className="answer-btn positive-btn">
            Positive (P)
          </Button>
          <Button onClick={() => onSubmit(0)} className="answer-btn zero-btn">
            Zero (Z)
          </Button>
          <Button onClick={() => onSubmit('negative')} className="answer-btn negative-btn">
            Negative (N)
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="answer-section">
      <div className="answer-input-row">
        <input
          ref={inputRef}
          type="text"
          className="answer-input"
          value={userAnswer}
          onChange={(event) => onAnswerChange(event.target.value)}
          placeholder={
            challenge.type === 'substring'
              ? 'Click letters for text or indices for numbers'
              : challenge.type === 'indexOf'
                ? 'Click indices for numbers or letters for text'
                : 'Type your answer'
          }
          disabled={challenge.type === 'substring' && selectedIndices.length === 2}
        />
        <Button onClick={() => onSubmit(userAnswer)} disabled={userAnswer === ''} className="submit-btn">
          Submit ↵
        </Button>
      </div>
      {challenge.type === 'substring' && selectedIndices.length === 1 && (
        <div className="selection-hint">Click another letter to complete your selection</div>
      )}
    </div>
  )
}
