import React from 'react'

/**
 * ChallengeQuestion Component
 * Displays the challenge prompt safely
 */
interface ChallengeQuestionProps {
  prompt: unknown
}

export default function ChallengeQuestion({ prompt }: ChallengeQuestionProps) {
  if (prompt == null || typeof prompt !== 'string' || prompt.trim().length === 0) {
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
