import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import Button from '@src/components/ui/Button'
import {
  POSTBOARD_REACTION_IDS,
  POSTBOARD_REACTION_LABELS,
  POSTBOARD_REACTION_SYMBOLS,
  type PostboardInstructorSnapshot,
  type PostboardPost,
  type PostboardReactionId,
} from '../../shared/types'

interface LocationState {
  createSessionPayload?: {
    instructorPasscode?: unknown
  }
  instructorPasscode?: unknown
}

const POLL_INTERVAL_MS = 2500

function readInstructorPasscode(sessionId: string | undefined, state: unknown): string {
  const locationState = state != null && typeof state === 'object' && !Array.isArray(state)
    ? state as LocationState
    : {}
  const statePasscode = typeof locationState.createSessionPayload?.instructorPasscode === 'string'
    ? locationState.createSessionPayload.instructorPasscode
    : typeof locationState.instructorPasscode === 'string'
      ? locationState.instructorPasscode
      : ''

  if (statePasscode) return statePasscode
  if (!sessionId || typeof window === 'undefined') return ''
  return window.sessionStorage.getItem(`postboard_instructor_${sessionId}`) ?? ''
}

function getLaunchDefaults(search: string): { prompt: string; autoApprove: boolean | null } {
  const params = new URLSearchParams(search)
  const prompt = params.get('prompt')?.trim() ?? ''
  const autoApprove = params.has('autoApprove') ? params.get('autoApprove') === 'true' : null
  return { prompt, autoApprove }
}

function getPostStatusLabel(post: PostboardPost): string {
  if (post.hiddenAt != null) return `${post.status}, hidden`
  return post.status
}

export default function PostboardManager(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const location = useLocation()
  const [instructorPasscode] = useState(() => readInstructorPasscode(sessionId, location.state))
  const [snapshot, setSnapshot] = useState<PostboardInstructorSnapshot | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const [postDraft, setPostDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSavingSetup, setIsSavingSetup] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [launchDefaultsApplied, setLaunchDefaultsApplied] = useState(false)

  const launchDefaults = useMemo(() => getLaunchDefaults(location.search), [location.search])

  const fetchState = useCallback(async () => {
    if (!sessionId || !instructorPasscode) return
    const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/instructor-state`, {
      headers: { 'x-instructor-passcode': instructorPasscode },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Could not load Postboard')
    const nextSnapshot = await response.json() as PostboardInstructorSnapshot
    setSnapshot(nextSnapshot)
    setPromptDraft((current) => current || nextSnapshot.prompt.text)
    setAutoApprove(nextSnapshot.settings.autoApprove)
  }, [instructorPasscode, sessionId])

  useEffect(() => {
    if (!sessionId || !instructorPasscode) return undefined
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
  }, [fetchState, instructorPasscode, sessionId])

  useEffect(() => {
    if (!snapshot || launchDefaultsApplied || !instructorPasscode || !sessionId) return
    if (snapshot.prompt.text || (!launchDefaults.prompt && launchDefaults.autoApprove == null)) {
      setLaunchDefaultsApplied(true)
      return
    }

    setLaunchDefaultsApplied(true)
    const nextPrompt = launchDefaults.prompt || snapshot.prompt.text
    const nextAutoApprove = launchDefaults.autoApprove ?? snapshot.settings.autoApprove
    setPromptDraft(nextPrompt)
    setAutoApprove(nextAutoApprove)
    void saveSetup(nextPrompt, nextAutoApprove)
  }, [instructorPasscode, launchDefaults, launchDefaultsApplied, sessionId, snapshot])

  const postJson = useCallback(async (path: string, body: Record<string, unknown> = {}) => {
    if (!sessionId) throw new Error('Missing session id')
    const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-instructor-passcode': instructorPasscode,
      },
      body: JSON.stringify({ ...body, instructorPasscode }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error || 'Postboard update failed')
    }
    return response.json() as Promise<unknown>
  }, [instructorPasscode, sessionId])

  const saveSetup = useCallback(async (nextPrompt = promptDraft, nextAutoApprove = autoApprove) => {
    setIsSavingSetup(true)
    try {
      const nextSnapshot = await postJson('/setup', {
        prompt: nextPrompt,
        autoApprove: nextAutoApprove,
      }) as PostboardInstructorSnapshot
      setSnapshot(nextSnapshot)
      setPromptDraft(nextSnapshot.prompt.text)
      setAutoApprove(nextSnapshot.settings.autoApprove)
      setError(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSavingSetup(false)
    }
  }, [autoApprove, postJson, promptDraft])

  const handleSetupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveSetup()
  }

  const handleInstructorPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = postDraft.trim()
    if (!text) return
    setIsPosting(true)
    try {
      await postJson('/posts', { text })
      setPostDraft('')
      await fetchState()
      setError(null)
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError))
    } finally {
      setIsPosting(false)
    }
  }

  const runPostAction = async (postId: string, action: string, body: Record<string, unknown> = {}) => {
    try {
      const nextSnapshot = await postJson(`/posts/${encodeURIComponent(postId)}/${action}`, body) as PostboardInstructorSnapshot
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    }
  }

  const reorderPost = async (postId: string, direction: -1 | 1) => {
    if (!snapshot) return
    const posts = [...snapshot.posts]
    const index = posts.findIndex((post) => post.id === postId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= posts.length) return
    const [post] = posts.splice(index, 1)
    if (post == null) return
    posts.splice(nextIndex, 0, post)
    try {
      const nextSnapshot = await postJson('/reorder', { postIds: posts.map((entry) => entry.id) }) as PostboardInstructorSnapshot
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : String(reorderError))
    }
  }

  const reactToPost = async (postId: string, reactionId: PostboardReactionId) => {
    try {
      await postJson(`/posts/${encodeURIComponent(postId)}/react`, { reactionId })
      await fetchState()
    } catch (reactionError) {
      setError(reactionError instanceof Error ? reactionError.message : String(reactionError))
    }
  }

  if (!sessionId) {
    return <main className="postboard-shell"><p>Missing Postboard session.</p></main>
  }

  if (!instructorPasscode) {
    return (
      <main className="postboard-shell">
        <SessionHeader activityName="Postboard" sessionId={sessionId} />
        <div className="postboard-alert" role="alert">
          Instructor credentials were not found for this tab. Start Postboard from the dashboard again to manage this session.
        </div>
      </main>
    )
  }

  const pendingPosts = snapshot?.posts.filter((post) => post.status === 'pending') ?? []
  const boardPosts = snapshot?.posts.filter((post) => post.status === 'approved') ?? []
  const rejectedPosts = snapshot?.posts.filter((post) => post.status === 'rejected') ?? []

  return (
    <main className="postboard-shell">
      <SessionHeader activityName="Postboard" sessionId={sessionId} />

      {error && <div className="postboard-alert" role="alert">{error}</div>}

      <section className="postboard-panel" aria-labelledby="postboard-setup-title">
        <h2 id="postboard-setup-title">Prompt</h2>
        <form className="postboard-form" onSubmit={handleSetupSubmit}>
          <label>
            <span>Prompt text</span>
            <textarea
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              rows={3}
              maxLength={1000}
            />
          </label>
          <label className="postboard-checkbox">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(event) => setAutoApprove(event.target.checked)}
            />
            <span>Auto-approve student notes</span>
          </label>
          <Button type="submit" disabled={isSavingSetup} aria-disabled={isSavingSetup}>
            {isSavingSetup ? 'Saving...' : 'Save prompt'}
          </Button>
        </form>
      </section>

      <section className="postboard-panel" aria-labelledby="postboard-instructor-post-title">
        <h2 id="postboard-instructor-post-title">Add Instructor Note</h2>
        <form className="postboard-form" onSubmit={handleInstructorPost}>
          <label>
            <span>Note text</span>
            <textarea
              value={postDraft}
              onChange={(event) => setPostDraft(event.target.value)}
              rows={3}
              maxLength={1200}
            />
          </label>
          <Button type="submit" disabled={isPosting || postDraft.trim().length === 0} aria-disabled={isPosting || postDraft.trim().length === 0}>
            {isPosting ? 'Posting...' : 'Post note'}
          </Button>
        </form>
      </section>

      <section className="postboard-grid" aria-label="Postboard moderation and board">
        <div className="postboard-column">
          <h2>Moderation Queue ({pendingPosts.length})</h2>
          {pendingPosts.length === 0 && <p className="postboard-empty">No pending notes.</p>}
          {pendingPosts.map((post) => (
            <article key={post.id} className="postboard-card postboard-card-pending">
              <p>{post.text}</p>
              <p className="postboard-meta">{post.authorName}</p>
              <div className="postboard-actions">
                <Button type="button" onClick={() => void runPostAction(post.id, 'approve')}>Approve</Button>
                <Button type="button" onClick={() => void runPostAction(post.id, 'reject')}>Reject</Button>
              </div>
            </article>
          ))}
        </div>

        <div className="postboard-column postboard-column-wide">
          <h2>Board ({boardPosts.length})</h2>
          {boardPosts.length === 0 && <p className="postboard-empty">No approved notes yet.</p>}
          {boardPosts.map((post, index) => (
            <article key={post.id} className="postboard-card">
              <div className="postboard-card-header">
                <p className="postboard-meta">{post.authorName} · {getPostStatusLabel(post)}</p>
                <div className="postboard-move-actions">
                  <button type="button" onClick={() => void reorderPost(post.id, -1)} disabled={index === 0} aria-label="Move note up">Up</button>
                  <button type="button" onClick={() => void reorderPost(post.id, 1)} disabled={index === boardPosts.length - 1} aria-label="Move note down">Down</button>
                </div>
              </div>
              <p>{post.text}</p>
              <div className="postboard-reactions" aria-label="Instructor reactions">
                {POSTBOARD_REACTION_IDS.map((reactionId) => (
                  <button
                    key={reactionId}
                    type="button"
                    onClick={() => void reactToPost(post.id, reactionId)}
                    aria-label={`React with ${POSTBOARD_REACTION_LABELS[reactionId]}`}
                  >
                    {POSTBOARD_REACTION_SYMBOLS[reactionId]} {snapshot?.reactionCounts[post.id]?.[reactionId] ?? 0}
                  </button>
                ))}
              </div>
              <div className="postboard-actions">
                <Button type="button" onClick={() => void runPostAction(post.id, post.hiddenAt == null ? 'hide' : 'unhide')}>
                  {post.hiddenAt == null ? 'Hide' : 'Unhide'}
                </Button>
                <Button type="button" onClick={() => void runPostAction(post.id, 'flag', { reason: 'Follow up' })}>
                  Flag ({snapshot?.flags[post.id]?.length ?? 0})
                </Button>
              </div>
            </article>
          ))}
        </div>

        <div className="postboard-column">
          <h2>Rejected ({rejectedPosts.length})</h2>
          {rejectedPosts.length === 0 && <p className="postboard-empty">No rejected notes.</p>}
          {rejectedPosts.map((post) => (
            <article key={post.id} className="postboard-card postboard-card-rejected">
              <p>{post.text}</p>
              <p className="postboard-meta">{post.authorName}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
