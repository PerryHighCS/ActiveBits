import Button from '@src/components/ui/Button'
import type { JavaStringMethodId } from '../../javaStringPracticeTypes.js'

interface ChallengeSelectorProps {
  selectedTypes: Set<JavaStringMethodId>
  onTypeSelect?: (type: JavaStringMethodId) => void
}

export default function ChallengeSelector({ selectedTypes, onTypeSelect }: ChallengeSelectorProps) {
  const types: Array<{ id: JavaStringMethodId; label: string }> = [
    { id: 'all', label: 'All Methods' },
    { id: 'substring', label: 'substring()' },
    { id: 'indexOf', label: 'indexOf()' },
    { id: 'equals', label: 'equals()' },
    { id: 'length', label: 'length()' },
    { id: 'compareTo', label: 'compareTo()' },
  ]

  const isReadOnly = !onTypeSelect

  return (
    <div className="type-selector">
      {types.map((type) => (
        <Button
          key={type.id}
          onClick={isReadOnly ? undefined : () => onTypeSelect?.(type.id)}
          className={`type-btn ${selectedTypes.has(type.id) ? 'selected' : ''} ${isReadOnly ? 'read-only' : ''}`}
          aria-pressed={selectedTypes.has(type.id)}
          disabled={isReadOnly}
        >
          {type.label}
        </Button>
      ))}
    </div>
  )
}
