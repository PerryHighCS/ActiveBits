import { useEffect, useId, useState } from 'react'
import Modal from '@src/components/ui/Modal'
import Button from '@src/components/ui/Button'
import { isValidMobCodePath, normalizeMobCodePath } from '../utils/fileUtils'

interface FileNameModalProps {
  open: boolean
  title: string
  initialValue?: string
  submitLabel: string
  onClose: () => void
  onSubmit: (path: string) => void
}

export default function FileNameModal({
  open,
  title,
  initialValue = '',
  submitLabel,
  onClose,
  onSubmit,
}: FileNameModalProps) {
  const [value, setValue] = useState(initialValue)
  const inputId = useId()

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const normalized = normalizeMobCodePath(value)
  const isValid = normalized.length > 0 && normalized === value.trim() && isValidMobCodePath(normalized)

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!isValid) return
          onSubmit(normalized)
        }}
      >
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
          Path
        </label>
        <input
          id={inputId}
          className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
        />
        {!isValid && value.trim().length > 0 && (
          <p className="text-sm text-red-700">Use a safe relative path without traversal segments.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
