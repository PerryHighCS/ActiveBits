import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { readSessionParticipantContext } from '@src/components/common/sessionParticipantContext'
import Button from '@src/components/ui/Button'
import NoteStyleSelect from '../../../shared/client/components/NoteStyleSelect'
import {
  POSTBOARD_REACTION_IDS,
  POSTBOARD_REACTION_LABELS,
  POSTBOARD_REACTION_SYMBOLS,
  type PostboardReactionId,
  type PostboardStudentSnapshot,
} from '../../shared/types'
import {
  DEFAULT_NOTE_STYLE_ID,
  getNoteStyleClassName,
} from '../../../shared/noteStyles'

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
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchState = useCallback(async () => {
    if (!sessionId) return
    const params = new URLSearchParams()
    if (identity.studentId) params.set('studentId', identity.studentId)
    const query = params.toString()
    const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/student-state${query ? `?${query}` : ''}`, {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Could not load Postboard')
    setSnapshot(await response.json() as PostboardStudentSnapshot)
  }, [identity.studentId, sessionId])

  useEffect(() => {
    if (!sessionId) return undefined
    let cancelled = false
    const load = async () => {
      try {
        await fetchState()
        if (!cancelled) setError(null)
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

  if (!sessionId) {
    return <main className="postboard-shell"><p>Missing Postboard session.</p></main>
  }

  const promptText = snapshot?.prompt.text || 'Your teacher is setting up the prompt.'
  const composeStyleClass = getNoteStyleClassName(styleId)

  return (
    <main className="postboard-shell postboard-student-shell">
      <section className="postboard-panel postboard-prompt-panel" aria-labelledby="postboard-student-prompt">
        <p className="postboard-eyebrow">Postboard</p>
        <h1 id="postboard-student-prompt">{promptText}</h1>
      </section>

      {error && <div className="postboard-alert" role="alert">{error}</div>}

      <section className="postboard-board" aria-label="Shared notes">
        {snapshot == null && <p className="postboard-empty">Loading notes...</p>}
        {snapshot != null && snapshot.posts.length === 0 && <p className="postboard-empty">No notes have been approved yet.</p>}
        {snapshot?.posts.map((post) => (
          <article key={post.id} className={`postboard-card ${getNoteStyleClassName(post.styleId)}`}>
            <p>{post.text}</p>
            {!post.isOwnPost && (
              <div className="postboard-reactions" aria-label="React to note">
                {POSTBOARD_REACTION_IDS.map((reactionId) => (
                  <button
                    key={reactionId}
                    type="button"
                    onClick={() => void reactToPost(post.id, reactionId)}
                    aria-label={`React with ${POSTBOARD_REACTION_LABELS[reactionId]}`}
                  >
                    {POSTBOARD_REACTION_SYMBOLS[reactionId]} {snapshot.reactionCounts[post.id]?.[reactionId] ?? 0}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {snapshot?.ownRejectedPosts && snapshot.ownRejectedPosts.length > 0 && (
        <section className="postboard-panel" aria-labelledby="postboard-rejected-title">
          <h2 id="postboard-rejected-title">Revise a returned note</h2>
          <div className="postboard-card-list">
            {snapshot.ownRejectedPosts.map((post) => (
              <article key={post.id} className={`postboard-card ${getNoteStyleClassName(post.styleId)} postboard-card-rejected`}>
                <p>{post.text}</p>
                <Button
                  type="button"
                  onClick={() => {
                    setDraft(post.text)
                    setStyleId(post.styleId)
                  }}
                >
                  Move to editor
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="postboard-panel postboard-compose-panel" aria-labelledby="postboard-submit-title">
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
    </main>
  )
}
