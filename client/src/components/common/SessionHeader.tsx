import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useClipboard } from '@src/hooks/useClipboard'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { buildStudentJoinUrl, isEmbeddedChildSessionId } from './sessionHeaderUtils'

export interface SessionHeaderProps {
  activityName: string
  sessionId?: string
  simple?: boolean
  includeBottomMargin?: boolean
  onEndSession?: () => void | Promise<void>
  actionMenuLabel?: string
  actionMenuRole?: 'menu'
  actionMenuContent?: ReactNode
  headerActions?: ReactNode
  centerHeaderActions?: ReactNode
}

const ACTION_MENU_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')
const ACTION_MENU_ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].join(',')

interface ActionMenuProps {
  actionMenuContent: ReactNode
  actionMenuLabel: string
  resolvedActionMenuRole?: 'menu'
}

function isVisibleActionMenuElement(element: HTMLElement): boolean {
  if (element.hidden === true || element.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function getActionMenuFocusableElements(container: HTMLDivElement | null): HTMLElement[] {
  if (!container) return []
  const selector = container.getAttribute('role') === 'menu'
    ? ACTION_MENU_ITEM_SELECTOR
    : ACTION_MENU_FOCUSABLE_SELECTOR
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((element) => (
      !element.hasAttribute('disabled')
      && element.tabIndex !== -1
      && isVisibleActionMenuElement(element)
    ))
}

function ActionMenu({
  actionMenuContent,
  actionMenuLabel,
  resolvedActionMenuRole,
}: ActionMenuProps) {
  const [showActionMenu, setShowActionMenu] = useState(false)
  const actionMenuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeActionMenu = useCallback((returnFocus = false) => {
    setShowActionMenu(false)
    if (returnFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0)
    }
  }, [])

  useEffect(() => {
    if (!showActionMenu) return
    window.setTimeout(() => {
      const [firstFocusable] = getActionMenuFocusableElements(menuRef.current)
      firstFocusable?.focus()
    }, 0)
  }, [showActionMenu])

  useEffect(() => {
    if (!showActionMenu) return

    const handleDocumentPointer = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeActionMenu()
    }

    document.addEventListener('mousedown', handleDocumentPointer)
    document.addEventListener('touchstart', handleDocumentPointer)

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointer)
      document.removeEventListener('touchstart', handleDocumentPointer)
    }
  }, [closeActionMenu, showActionMenu])

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (resolvedActionMenuRole !== 'menu' || event.key !== 'ArrowDown') return
    event.preventDefault()
    setShowActionMenu(true)
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeActionMenu(true)
      return
    }

    if (resolvedActionMenuRole !== 'menu') return

    const focusableElements = getActionMenuFocusableElements(menuRef.current)
    if (focusableElements.length === 0) return

    const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement)
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % focusableElements.length
    } else if (event.key === 'ArrowUp') {
      nextIndex = currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = focusableElements.length - 1
    }

    if (nextIndex === null) return
    event.preventDefault()
    focusableElements[nextIndex]?.focus()
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        onClick={() => setShowActionMenu((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        variant="outline"
        aria-expanded={showActionMenu}
        aria-haspopup={resolvedActionMenuRole === 'menu' ? 'menu' : undefined}
        aria-controls={showActionMenu ? actionMenuId : undefined}
      >
        {actionMenuLabel}
      </Button>
      {showActionMenu && (
        <div
          ref={menuRef}
          id={actionMenuId}
          aria-label={actionMenuLabel}
          role={resolvedActionMenuRole === 'menu' ? 'menu' : undefined}
          onKeyDown={handleMenuKeyDown}
          className="absolute left-0 z-20 mt-2 min-w-56 rounded border border-gray-200 bg-white p-2 shadow-lg"
        >
          {actionMenuContent}
        </div>
      )}
    </div>
  )
}

/**
 * SessionHeader - Reusable header for activity manager pages
 * Shows activity name, join code, join URL, and end session button
 */
export default function SessionHeader({
  activityName,
  sessionId,
  onEndSession,
  simple = false,
  includeBottomMargin = true,
  actionMenuLabel = 'Activity Actions',
  actionMenuRole,
  actionMenuContent,
  headerActions,
  centerHeaderActions,
}: SessionHeaderProps) {
  const [showEndModal, setShowEndModal] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const { copyToClipboard, isCopied } = useClipboard(1500)
  const navigate = useNavigate()
  // Only pass "menu" when callers provide content with matching menu-item semantics.
  const resolvedActionMenuRole = actionMenuContent != null ? actionMenuRole : undefined

  const studentJoinUrl =
    sessionId && typeof window !== 'undefined' ? buildStudentJoinUrl(window.location.origin, sessionId) : ''
  const embeddedChildSession = isEmbeddedChildSessionId(sessionId)

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

  if (embeddedChildSession) {
    return (
      <div className={`${includeBottomMargin ? 'mb-6 ' : ''}bg-white border-b border-gray-200 px-6 py-4`}>
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">{activityName}</h1>
            {actionMenuContent != null && (
              <ActionMenu
                actionMenuContent={actionMenuContent}
                actionMenuLabel={actionMenuLabel}
                resolvedActionMenuRole={resolvedActionMenuRole}
              />
            )}
            {headerActions}
          </div>

          {centerHeaderActions != null && (
            <div className="order-last flex w-full justify-center md:absolute md:left-1/2 md:top-1/2 md:order-none md:w-auto md:-translate-x-1/2 md:-translate-y-1/2">
              {centerHeaderActions}
            </div>
          )}
        </div>
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
      <div className={`${includeBottomMargin ? 'mb-6 ' : ''}bg-white border-b border-gray-200 px-6 py-4`}>
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">{activityName}</h1>
            {actionMenuContent != null && (
              <ActionMenu
                actionMenuContent={actionMenuContent}
                actionMenuLabel={actionMenuLabel}
                resolvedActionMenuRole={resolvedActionMenuRole}
              />
            )}
            {headerActions}
          </div>

          {centerHeaderActions != null && (
            <div className="order-last flex w-full justify-center md:absolute md:left-1/2 md:top-1/2 md:order-none md:w-auto md:-translate-x-1/2 md:-translate-y-1/2">
              {centerHeaderActions}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
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
