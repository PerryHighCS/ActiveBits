import './AlgorithmPicker.css'

interface PickerAlgorithm {
  id?: string
  name?: string
  description?: string
}

interface AlgorithmPickerProps {
  algorithms: PickerAlgorithm[]
  selectedId?: string | null
  onSelect: (algorithmId: string) => void
  title?: string
  className?: string
}

export default function AlgorithmPicker({
  algorithms,
  selectedId,
  onSelect,
  title = 'Select Algorithm',
  className = '',
}: AlgorithmPickerProps) {
  return (
    <div className={`algorithm-picker ${className}`}>
      <label className="algorithm-picker-label">{title}</label>
      <div className="algorithm-picker-grid">
        {algorithms.map((algo, index) => (
          <button
            key={algo.id ?? `algorithm-${index}`}
            type="button"
            className={`algorithm-card ${selectedId === algo.id ? 'selected' : ''}`}
            onClick={() => {
              if (typeof algo.id === 'string') {
                onSelect(algo.id)
              }
            }}
            disabled={typeof algo.id !== 'string'}
          >
            <div className="algorithm-card-title">{algo.name}</div>
            <div className="algorithm-card-description">{algo.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
