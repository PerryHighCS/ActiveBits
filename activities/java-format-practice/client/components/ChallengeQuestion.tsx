import React from 'react'

/**
 * ChallengeQuestion Component
 * Displays the challenge prompt safely
 */
interface ChallengeQuestionProps {
  prompt: string | null | undefined
}

export default function ChallengeQuestion({ prompt }: ChallengeQuestionProps) {
  if (prompt == null || prompt.trim().length === 0) {
    return (
      <React.Fragment>
        <div className="question">Invalid question</div>
      </React.Fragment>
    )
  }

  return (
    <React.Fragment>
      <div className="question">{prompt}</div>
    </React.Fragment>
  )
}
