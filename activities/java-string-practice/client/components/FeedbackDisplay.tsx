import { useEffect } from 'react'
import Button from '@src/components/ui/Button'
import type { FeedbackState } from '../../javaStringPracticeTypes.js'

interface FeedbackDisplayProps {
  feedback: FeedbackState | null
  onNewChallenge: () => void
}

export default function FeedbackDisplay({ feedback, onNewChallenge }: FeedbackDisplayProps) {
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        onNewChallenge()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [onNewChallenge])

  if (!feedback) return null

  return (
    <div className={`feedback ${feedback.isCorrect ? 'correct' : 'incorrect'}`}>
      <div className="feedback-message">{feedback.message}</div>
      <Button onClick={onNewChallenge} className="new-challenge-btn">
        Next Challenge ↵
      </Button>
    </div>
  )
}
