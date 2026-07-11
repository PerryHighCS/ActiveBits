import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { readSessionParticipantContext } from '@src/components/common/sessionParticipantContext'
import Button from '@src/components/ui/Button'
import NoteStyleSelect from '../../../shared/client/components/NoteStyleSelect.js'
import ReactionSummary from '../../../shared/client/components/ReactionSummary.js'
import {
  POSTBOARD_REACTION_OPTIONS,
  type PostboardReactionId,
  type PostboardStudentSnapshot,
} from '../../shared/types.js'
import {
  DEFAULT_NOTE_STYLE_ID,
  getNoteStyleClassName,
} from '../../../shared/noteStyles.js'

interface PostboardStudentProps {
  sessionData?: {
    sessionId?: string
    studentId?: string
    studentName?: string
  }
}

interface StudentIdentity {
  studentId: string | null
  studentName: string | null
}

const POLL_INTERVAL_MS = 2500

function readStudentIdentity(sessionId: string | null, sessionData: PostboardStudentProps['sessionData']): StudentIdentity {
  if (!sessionId || typeof window === 'undefined') {
    return {
      studentId: sessionData?.studentId ?? null,
      studentName: sessionData?.studentName ?? null,
    }
  }

  const context = readSessionParticipantContext(window.localStorage, sessionId)
  return {
    studentId: context?.studentId ?? sessionData?.studentId ?? null,
    studentName: context?.studentName ?? sessionData?.studentName ?? null,
  }
}

export default function PostboardStudent({ sessionData }: PostboardStudentProps): React.JSX.Element {
  const sessionId = sessionData?.sessionId ?? null
  const identity = useMemo(() => readStudentIdentity(sessionId, sessionData), [sessionData, sessionId])
  const [snapshot, setSnapshot] = useState<PostboardStudentSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [styleId, setStyleId] = useState(DEFAULT_NOTE_STYLE_ID)
  const [dismissedOwnPostIds, setDismissedOwnPostIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fetchRequestIdRef = useRef(0)

  const fetchState = useCallback(async () => {
    if (!sessionId) return false
    const requestId = fetchRequestIdRef.current + 1
    fetchRequestIdRef.current = requestId
    const params = new URLSearchParams()
    if (identity.studentId) params.set('studentId', identity.studentId)
    const query = params.toString()
    const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/student-state${query ? `?${query}` : ''}`, {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Could not load Postboard')
    const nextSnapshot = await response.json() as PostboardStudentSnapshot
    if (requestId !== fetchRequestIdRef.current) return false
    setSnapshot(nextSnapshot)
    return true
  }, [identity.studentId, sessionId])

  useEffect(() => {
    if (!sessionId) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const didCommit = await fetchState()
        if (!cancelled && didCommit) setError(null)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    }
    void load()
    const interval = window.setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      fetchRequestIdRef.current += 1
      window.clearInterval(interval)
    }
  }, [fetchState, sessionId])

  const submitPost = async (text: string) => {
    if (!sessionId || !identity.studentId) {
      setError('Join the session with your name before posting.')
      return
    }
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          styleId,
          studentId: identity.studentId,
          studentName: identity.studentName,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Could not submit note')
      }
      setDraft('')
      await fetchState()
      setError(null)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (text.length === 0) return
    void submitPost(text)
  }

  const reactToPost = async (postId: string, reactionId: PostboardReactionId) => {
    if (!sessionId || !identity.studentId) {
      setError('Join the session with your name before reacting.')
      return
    }
    try {
      const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/posts/${encodeURIComponent(postId)}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: identity.studentId,
          reactionId,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Could not react to note')
      }
      await fetchState()
      setError(null)
    } catch (reactionError) {
      setError(reactionError instanceof Error ? reactionError.message : String(reactionError))
    }
  }

  const deleteRejectedPost = async (postId: string) => {
    if (!sessionId || !identity.studentId) {
      setError('Join the session with your name before deleting a returned note.')
      return
    }
    try {
      const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/posts/${encodeURIComponent(postId)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: identity.studentId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Could not delete returned note')
      }
      setDismissedOwnPostIds((current) => new Set(current).add(postId))
      await fetchState()
      setError(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  if (!sessionId) {
    return <main className="postboard-shell"><p>Missing Postboard session.</p></main>
  }

  const promptText = snapshot?.prompt.text || 'Your teacher is setting up the prompt.'
  const composeStyleClass = getNoteStyleClassName(styleId)
  const boardPosts = snapshot?.posts.filter((post) => !dismissedOwnPostIds.has(post.id)) ?? []
  const canReact = Boolean(identity.studentId)

  return (
    <main className="postboard-shell postboard-student-shell">
      <div className="postboard-layout">
        <div className="postboard-main">
          <section className="postboard-panel postboard-prompt-panel" aria-labelledby="postboard-student-prompt">
            <p className="postboard-eyebrow">Postboard</p>
            <h1 id="postboard-student-prompt">{promptText}</h1>
          </section>

          {error && <div className="postboard-alert" role="alert">{error}</div>}

          <section className="postboard-board" aria-label="Shared notes">
            {snapshot == null && <p className="postboard-empty">Loading notes...</p>}
            {snapshot != null && boardPosts.length === 0 && <p className="postboard-empty">No notes have been posted.</p>}
            {boardPosts.map((post) => {
              const isRejectedOwn = post.status === 'rejected' && post.isOwnPost
              const isFaded = isRejectedOwn || (post.status === 'pending' && post.isOwnPost)
              return (
                <article
                  key={post.id}
                  className={`postboard-card ${getNoteStyleClassName(post.styleId)}${isRejectedOwn ? ' postboard-card-rejected' : ''}`}
                >
                  {isRejectedOwn && (
                    <div className="postboard-card-header">
                      <span className="postboard-status-badge">Returned</span>
                      <div className="postboard-move-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(post.text)
                            setStyleId(post.styleId)
                            setDismissedOwnPostIds((current) => new Set(current).add(post.id))
                          }}
                          aria-label="Edit returned note"
                          title="Edit returned note"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteRejectedPost(post.id)
                          }}
                          aria-label="Dismiss returned note"
                          title="Dismiss returned note"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  )}
                  <p className={isFaded ? 'postboard-card-fade' : undefined}>{post.text}</p>
                  {!post.isOwnPost && (
                    <ReactionSummary
                      reactions={snapshot?.reactionCounts[post.id] ?? {}}
                      options={POSTBOARD_REACTION_OPTIONS}
                      viewerReaction={snapshot?.viewerReactions[post.id] ?? null}
                      canReact={canReact}
                      onReact={canReact ? (reactionId) => void reactToPost(post.id, reactionId as PostboardReactionId) : undefined}
                      className={`postboard-reactions${isFaded ? ' postboard-card-fade' : ''}`}
                      triggerPosition="end"
                    />
                  )}
                </article>
              )
            })}
          </section>
        </div>

        <section className="postboard-panel postboard-compose-panel postboard-sticky-side" aria-labelledby="postboard-submit-title">
          <h2 id="postboard-submit-title">Add a note</h2>
          <form className="postboard-form" onSubmit={handleSubmit}>
            <label>
              <span className="postboard-sr-only">Note</span>
              <div className={`note-style-field ${composeStyleClass}`}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={4}
                  maxLength={1200}
                />
              </div>
            </label>
            <div className="postboard-compose-actions">
              <NoteStyleSelect value={styleId} onChange={setStyleId} className="postboard-note-style-select" />
              <Button type="submit" disabled={isSubmitting || draft.trim().length === 0} aria-disabled={isSubmitting || draft.trim().length === 0}>
                {isSubmitting ? 'Submitting...' : 'Submit note'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
