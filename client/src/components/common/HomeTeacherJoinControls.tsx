import React, { type FormEvent } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

void React

interface HomeTeacherJoinControlsProps {
  open: boolean
  sessionId: string
  teacherCode: string
  error: string | null
  isSubmitting: boolean
  onOpen: () => void
  onClose: () => void
  onSessionIdChange: (value: string) => void
  onTeacherCodeChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export default function HomeTeacherJoinControls({
  open,
  sessionId,
  teacherCode,
  error,
  isSubmitting,
  onOpen,
  onClose,
  onSessionIdChange,
  onTeacherCodeChange,
  onSubmit,
}: HomeTeacherJoinControlsProps) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onOpen}>
        Teacher Join
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!isSubmitting) {
            onClose()
          }
        }}
        title="Teacher Join"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Join an active live session with the Join Code and teacher code.
          </p>

          <label className="flex flex-col gap-2 text-sm font-semibold text-gray-700">
            Join Code
            <input
              type="text"
              value={sessionId}
              onChange={(event) => onSessionIdChange(event.target.value)}
              className="border-2 border-gray-300 rounded px-4 py-2 font-mono focus:outline-none focus:border-blue-500"
              placeholder="Enter join code"
              autoComplete="off"
              disabled={isSubmitting}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-gray-700">
            Teacher code
            <input
              type="password"
              value={teacherCode}
              onChange={(event) => onTeacherCodeChange(event.target.value)}
              className="border-2 border-gray-300 rounded px-4 py-2 focus:outline-none focus:border-blue-500"
              placeholder="Enter teacher code"
              autoComplete="off"
              disabled={isSubmitting}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !sessionId.trim() || !teacherCode.trim()}>
              {isSubmitting ? 'Joining...' : 'Join as Teacher'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
