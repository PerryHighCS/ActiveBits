import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClipboard } from '@src/hooks/useClipboard'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

export interface SessionHeaderProps {
  activityName: string
  sessionId?: string
  simple?: boolean
  onEndSession?: () => void | Promise<void>
}

/**
 * SessionHeader - Reusable header for activity manager pages
 * Shows activity name, join code, join URL, and end session button
 */
export default function SessionHeader({ activityName, sessionId, onEndSession, simple = false }: SessionHeaderProps) {
  const [showEndModal, setShowEndModal] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const { copyToClipboard, isCopied } = useClipboard(1500)
  const navigate = useNavigate()

  const studentJoinUrl =
    sessionId && typeof window !== 'undefined' ? `${window.location.origin}/${sessionId}` : ''

  const copyLink = () => copyToClipboard(studentJoinUrl)
  const copyCode = () => copyToClipboard(sessionId)
  const handleCopyLinkClick = (event: MouseEvent<HTMLButtonElement>) => {
    void copyLink()
    if ((event.ctrlKey || event.metaKey) && studentJoinUrl) {
      window.open(studentJoinUrl, '_blank')
    }
  }

  if (simple) {
    return (
      <div className="bg-white border-b border-gray-200 px-6 py-4 mb-4">
        <h1 className="text-2xl font-bold text-gray-800">{activityName}</h1>
      </div>
    )
  }

  const handleEndSession = async () => {
    setIsEnding(true)
    setErrorMessage('')

    try {
      const response = await fetch(`/api/session/${sessionId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to end session')

      if (onEndSession) {
        await onEndSession()
      }

      void navigate('/manage')
    } catch (error) {
      console.error('Error ending session:', error)
      setErrorMessage('Failed to end session. Please try again.')
      setIsEnding(false)
    }
  }

  return (
    <>
      <div className="bg-white border-b border-gray-200 px-6 py-4 mb-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold text-gray-800">{activityName}</h1>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Join Code:</span>
                <code
                  onClick={copyCode}
                  className="px-3 py-1.5 rounded bg-gray-100 font-mono text-lg font-semibold text-gray-800 cursor-pointer hover:bg-gray-200 transition-colors"
                  title="Click to copy"
                >
                  {isCopied(sessionId) ? '✓ Copied!' : sessionId}
                </code>
              </div>

              <Button onClick={handleCopyLinkClick} variant="outline">
                {isCopied(studentJoinUrl) ? '✓ Copied!' : 'Copy Join URL'}
              </Button>
            </div>

            <Button
              onClick={() => setShowEndModal(true)}
              variant="outline"
              className="border-red-600! text-red-600! hover:bg-red-50! hover:text-red-700!"
            >
              End Session
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={showEndModal}
        onClose={() => !isEnding && setShowEndModal(false)}
        title="End Session"
      >
        <div className="space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{errorMessage}</p>
            </div>
          )}
          <p className="text-gray-700">
            Are you sure you want to end this session? All students will be disconnected and progress data will be
            cleared.
          </p>
          <p className="text-sm text-gray-600">
            Session ID: <code className="bg-gray-100 px-2 py-1 rounded">{sessionId}</code>
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              onClick={() => setShowEndModal(false)}
              variant="outline"
              disabled={isEnding}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEndSession}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isEnding}
            >
              {isEnding ? 'Ending...' : 'End Session'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
