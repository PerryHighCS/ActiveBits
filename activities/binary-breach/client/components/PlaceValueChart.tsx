import { buildPlaceValues } from '../../shared/binaryUtils.js'

interface PlaceValueChartProps {
  bits: number
  /** Optional binary string to highlight in the bit row */
  value?: string
  label?: string
}

export default function PlaceValueChart({ bits, value, label = 'PLACE VALUE REFERENCE' }: PlaceValueChartProps) {
  const powers = buildPlaceValues(bits)
  const paddedBits = value != null
    ? value.padStart(bits, '0').slice(-bits).split('')
    : null

  return (
    <div className="bb-register" aria-label={label}>
      <div className="bb-register-label">{label}</div>
      <div className="bb-register-cells">
        {powers.map((power, index) => {
          const bit = paddedBits?.[index]
          const bitClass = bit === '1' ? 'bb-register-cell-bit--1'
            : bit === '0' ? 'bb-register-cell-bit--0'
            : 'bb-register-cell-bit--empty'
          return (
            <div className="bb-register-cell" key={power}>
              <div className="bb-register-cell-power">{power}</div>
              <div className={`bb-register-cell-bit ${bitClass}`} aria-hidden="true">
                {bit ?? '·'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
