import type { JavaStringChallenge } from '../../javaStringPracticeTypes.js'

type SelectionType = 'letter' | 'index' | null

interface StringDisplayProps {
  challenge: JavaStringChallenge
  selectedIndices: number[]
  visualHintShown: boolean
  selectionType: SelectionType
  onLetterClick: (index: number) => void
  onIndexClick: (index: number) => void
}

export default function StringDisplay({
  challenge,
  selectedIndices,
  visualHintShown,
  selectionType,
  onLetterClick,
  onIndexClick,
}: StringDisplayProps) {
  const isInteractive = challenge.type === 'substring' || challenge.type === 'indexOf'

  const text =
    challenge.type === 'substring' || challenge.type === 'indexOf' || challenge.type === 'length'
      ? challenge.text
      : challenge.type === 'compareTo'
        ? challenge.callingText
        : challenge.text1

  function getLetterClassName(index: number): string {
    const classes = ['letter-box']

    if (visualHintShown) {
      if (challenge.type === 'substring') {
        if (challenge.methodType === '1-parameter') {
          if (index >= challenge.start) {
            classes.push('highlighted-answer')
          }
        } else if (typeof challenge.end === 'number' && index >= challenge.start && index < challenge.end) {
          classes.push('highlighted-answer')
        }
      } else if (challenge.type === 'indexOf') {
        const answerIndex = challenge.expectedAnswer
        if (answerIndex !== -1) {
          const searchLength = challenge.searchTerm.length
          if (index >= answerIndex && index < answerIndex + searchLength) {
            classes.push('highlighted-answer')
          }
        }
      }
    } else if ((challenge.type === 'substring' || challenge.type === 'indexOf') && selectionType === 'letter') {
      if (selectedIndices.length === 2) {
        const [start = 0, end = 0] = selectedIndices
        if (index >= start && index < end) {
          classes.push('selected')
        }
      } else if (selectedIndices.length === 1 && index === selectedIndices[0]) {
        classes.push('selected')
      }
    }

    return classes.join(' ')
  }

  return (
    <div className="string-display-container">
      <div className="variable-declaration">
        {challenge.type === 'substring' || challenge.type === 'indexOf' || challenge.type === 'length' ? (
          <>
            String {challenge.varName} = &quot;{challenge.text}&quot;;
            {visualHintShown && challenge.type === 'length' && (
              <span style={{ color: '#38a169', fontWeight: 'bold' }}>
                {' '}
                {'// length is ' + challenge.expectedAnswer}
              </span>
            )}
          </>
        ) : (
          <>
            String {challenge.var1} = &quot;{challenge.text1}&quot;;<br />
            String {challenge.var2} = &quot;{challenge.text2}&quot;;
            {visualHintShown && (
              <span style={{ color: '#38a169', fontWeight: 'bold' }}>
                {' '}
                {challenge.type === 'equals'
                  ? `equals() returns ${challenge.expectedAnswer}`
                  : challenge.expectedAnswer === 0
                    ? 'compareTo() returns 0 (strings are equal)'
                    : challenge.expectedAnswer === 'negative'
                      ? `compareTo() returns negative ("${challenge.callingText}" < "${challenge.parameterText}")`
                      : `compareTo() returns positive ("${challenge.callingText}" > "${challenge.parameterText}")`}
              </span>
            )}
          </>
        )}
      </div>

      {isInteractive && (
        <div className="string-container-wrapper">
          <div className="string-container">
            <div className="index-row">
              {text.split('').map((_char: string, index: number) => (
                <div
                  key={index}
                  className="index-label clickable-index"
                  onClick={() => onIndexClick(index)}
                  style={{ cursor: 'pointer' }}
                >
                  {index}
                </div>
              ))}
            </div>
            <div className="letters-row">
              {text.split('').map((char: string, index: number) => (
                <div
                  key={index}
                  className={getLetterClassName(index)}
                  onClick={() => onLetterClick(index)}
                  style={{ cursor: isInteractive ? 'pointer' : 'default' }}
                >
                  {char === ' ' ? '\u00A0' : char}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
