interface ChallengeQuestionPart {
  type: 'text' | 'code'
  content: string
}

interface ChallengeQuestionProps {
  question: string | null | undefined
}

function parseQuestionParts(question: string): ChallengeQuestionPart[] {
  const parts: ChallengeQuestionPart[] = []
  let lastIndex = 0
  const codeRegex = /<code>(.*?)<\/code>/g
  let match = codeRegex.exec(question)

  while (match) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: question.substring(lastIndex, match.index),
      })
    }

    parts.push({
      type: 'code',
      content: match[1] || '',
    })

    lastIndex = match.index + match[0].length
    match = codeRegex.exec(question)
  }

  if (lastIndex < question.length) {
    parts.push({
      type: 'text',
      content: question.substring(lastIndex),
    })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', content: question })
  }

  return parts
}

export default function ChallengeQuestion({ question }: ChallengeQuestionProps) {
  if (!question || typeof question !== 'string') {
    return <div className="question">Invalid question</div>
  }

  const parts = parseQuestionParts(question)

  return (
    <div className="question">
      {parts.map((part, index) =>
        part.type === 'code' ? <code key={index}>{part.content}</code> : <span key={index}>{part.content}</span>,
      )}
    </div>
  )
}
