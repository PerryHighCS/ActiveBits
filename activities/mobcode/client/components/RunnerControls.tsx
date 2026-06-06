import type { MobCodeRunnerId } from '../../shared/types'
import type { MobCodeRunnerDefinition } from '../runner/runnerUtils'

interface RunnerControlsProps {
  files: Record<string, string>
  runnerId: MobCodeRunnerId
  runners: readonly MobCodeRunnerDefinition[]
  onRunCode: () => void
  onRunnerChange: (runnerId: MobCodeRunnerId) => void
}

export default function RunnerControls({
  files,
  runnerId,
  runners,
  onRunCode,
  onRunnerChange,
}: RunnerControlsProps) {
  const selectedRunner = runners.find((runner) => runner.id === runnerId)
  const showRunnerPicker = runners.length > 1

  return (
    <>
      {showRunnerPicker && (
        <label className="mobcode-runner-picker">
          <span className="sr-only">Runner implementation</span>
          <select
            aria-label="Runner implementation"
            value={runnerId}
            onChange={(event) => onRunnerChange(event.target.value as MobCodeRunnerId)}
          >
            {runners.map((runner) => (
              <option key={runner.id} value={runner.id}>
                {runner.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="mobcode-runner-button"
        onClick={onRunCode}
        disabled={Object.keys(files).length === 0}
        title={selectedRunner?.description}
      >
        Run
      </button>
    </>
  )
}
