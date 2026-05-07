import { buildPlaceValues } from '../../shared/binaryUtils.js'

interface PlaceValueChartProps {
  bits: number
  /** Optional binary string to highlight in the bit row */
  value?: string
  label?: string
  mode?: 'display' | 'add-values' | 'toggle-bits'
  selectedPlaceValues?: readonly number[]
  onPlaceValueClick?: (power: number, index: number, currentBit: '0' | '1' | undefined) => void
}

export default function PlaceValueChart({
  bits,
  value,
  label = 'PLACE VALUE REFERENCE',
  mode = 'display',
  selectedPlaceValues = [],
  onPlaceValueClick,
}: PlaceValueChartProps) {
  const powers = buildPlaceValues(bits)
  const paddedBits = value != null
    ? value.padStart(bits, '0').slice(-bits).split('')
    : null
  const interactive = mode !== 'display' && onPlaceValueClick != null
  const selectedPlaceValueSet = new Set(selectedPlaceValues)

  function getCellLabel(power: number, bit: '0' | '1' | undefined): string {
    if (mode === 'add-values') {
      return bit === '1'
        ? `Toggle ${power}s place in decimal answer`
        : `${power}s place is off`
    }
    if (mode === 'toggle-bits') return `Toggle ${power}s bit`
    return `${power}s place`
  }

  return (
    <div className="bb-register" aria-label={label}>
      <div className="bb-register-label">{label}</div>
      <div className="bb-register-cells">
        {powers.map((power, index) => {
          const bit = paddedBits?.[index] === '1' ? '1'
            : paddedBits?.[index] === '0' ? '0'
            : undefined
          const bitClass = bit === '1' ? 'bb-register-cell-bit--1'
            : bit === '0' ? 'bb-register-cell-bit--0'
            : 'bb-register-cell-bit--empty'
          const cellClassName = `bb-register-cell${interactive ? ' bb-register-cell--interactive' : ''}`
          const cellContents = (
            <>
              <div className="bb-register-cell-power">{power}</div>
              <div className={`bb-register-cell-bit ${bitClass}`} aria-hidden="true">
                {bit ?? '·'}
              </div>
            </>
          )
          if (interactive) {
            const pressed = mode === 'add-values'
              ? selectedPlaceValueSet.has(power)
              : bit === '1'
            return (
              <button
                type="button"
                className={cellClassName}
                key={power}
                aria-label={getCellLabel(power, bit)}
                aria-pressed={pressed}
                onClick={() => onPlaceValueClick(power, index, bit)}
              >
                {cellContents}
              </button>
            )
          }
          return (
            <div className={cellClassName} key={power}>
              {cellContents}
            </div>
          )
        })}
      </div>
    </div>
  )
}
