import { buildPlaceValues } from '../../shared/binaryUtils.js'

interface PlaceValueChartProps {
  bits: number
}

export default function PlaceValueChart({ bits }: PlaceValueChartProps) {
  const values = buildPlaceValues(bits)
  return (
    <div className="binary-breach-place-values" aria-label="Binary place values">
      {values.map((value) => (
        <div className="binary-breach-place-value" key={value}>
          <span>{value}s</span>
        </div>
      ))}
    </div>
  )
}

