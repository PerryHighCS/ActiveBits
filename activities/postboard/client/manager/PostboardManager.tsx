import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import Button from '@src/components/ui/Button'
import InstructorFeedbackControls from '../../../shared/client/components/InstructorFeedbackControls.js'
import NoteStyleSelect from '../../../shared/client/components/NoteStyleSelect.js'
import ReactionSummary from '../../../shared/client/components/ReactionSummary.js'
import {
  POSTBOARD_REACTION_OPTIONS,
  type PostboardInstructorSnapshot,
  type PostboardReactionId,
} from '../../shared/types.js'
import {
  DEFAULT_NOTE_STYLE_ID,
  getNoteStyleClassName,
} from '../../../shared/noteStyles.js'

interface LocationState {
  createSessionPayload?: {
    instructorPasscode?: unknown
  }
  instructorPasscode?: unknown
}

const POLL_INTERVAL_MS = 2500

export function readInstructorPasscode(sessionId: string | undefined, state: unknown): string {
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
  try {
    return window.sessionStorage.getItem(`postboard_instructor_${sessionId}`) ?? ''
  } catch {
    return ''
  }
}

function getLaunchDefaults(search: string): { prompt: string; autoApprove: boolean | null } {
  const params = new URLSearchParams(search)
  const prompt = params.get('prompt')?.trim() ?? ''
  const autoApprove = params.has('autoApprove') ? params.get('autoApprove') === 'true' : null
  return { prompt, autoApprove }
}

export function reorderPostIds(currentIds: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return currentIds
  const fromIndex = currentIds.indexOf(draggedId)
  const targetIndex = currentIds.indexOf(targetId)
  if (fromIndex === -1 || targetIndex === -1) return currentIds
  const reordered = [...currentIds]
  const [moved] = reordered.splice(fromIndex, 1)
  if (moved === undefined) return currentIds
  reordered.splice(targetIndex, 0, moved)
  return reordered
}

export default function PostboardManager(): React.JSX.Element {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const location = useLocation()
  const [instructorPasscode, setInstructorPasscode] = useState(() => readInstructorPasscode(sessionId, location.state))
  const [snapshot, setSnapshot] = useState<PostboardInstructorSnapshot | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const [postDraft, setPostDraft] = useState('')
  const [postStyleId, setPostStyleId] = useState(DEFAULT_NOTE_STYLE_ID)
  const [error, setError] = useState<string | null>(null)
  const [isSavingSetup, setIsSavingSetup] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [launchDefaultsApplied, setLaunchDefaultsApplied] = useState(false)
  const [isSetupOpen, setIsSetupOpen] = useState(false)
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null)
  const [dragOverPostId, setDragOverPostId] = useState<string | null>(null)
  const autoApproveDirtyRef = useRef(false)
  const setupInitializedRef = useRef(false)
  const fetchRequestIdRef = useRef(0)

  const launchDefaults = useMemo(() => getLaunchDefaults(location.search), [location.search])

  useEffect(() => {
    setInstructorPasscode(readInstructorPasscode(sessionId, location.state))
    setSnapshot(null)
    setPromptDraft('')
    setAutoApprove(false)
    setLaunchDefaultsApplied(false)
    setError(null)
    autoApproveDirtyRef.current = false
    setupInitializedRef.current = false
    fetchRequestIdRef.current += 1
  }, [location.state, sessionId])

  const fetchState = useCallback(async () => {
    if (!sessionId || !instructorPasscode) return false
    const requestId = fetchRequestIdRef.current + 1
    fetchRequestIdRef.current = requestId
    const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}/instructor-state`, {
      headers: { 'x-instructor-passcode': instructorPasscode },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Could not load Postboard')
    const nextSnapshot = await response.json() as PostboardInstructorSnapshot
    if (requestId !== fetchRequestIdRef.current) return false
    setSnapshot(nextSnapshot)
    setPromptDraft((current) => current || nextSnapshot.prompt.text)
    if (!autoApproveDirtyRef.current) {
      setAutoApprove(nextSnapshot.settings.autoApprove)
    }
    if (!setupInitializedRef.current) {
      setupInitializedRef.current = true
      setIsSetupOpen(nextSnapshot.prompt.text.length === 0)
    }
    return true
  }, [instructorPasscode, sessionId])

  useEffect(() => {
    if (!sessionId || !instructorPasscode) return undefined
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
  }, [fetchState, instructorPasscode, sessionId])

  const postJson = useCallback(async (path: string, body: Record<string, unknown> = {}) => {
    if (!sessionId) throw new Error('Missing session id')
    const response = await fetch(`/api/postboard/${encodeURIComponent(sessionId)}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-instructor-passcode': instructorPasscode,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error || 'Postboard update failed')
    }
    return response.json() as Promise<unknown>
  }, [instructorPasscode, sessionId])

  const saveSetup = useCallback(async (
    nextPrompt = promptDraft,
    nextAutoApprove = autoApprove,
    options: { preservePromptDraft?: boolean } = {},
  ) => {
    setIsSavingSetup(true)
    try {
      const nextSnapshot = await postJson('/setup', {
        prompt: nextPrompt,
        autoApprove: nextAutoApprove,
      }) as PostboardInstructorSnapshot
      setSnapshot(nextSnapshot)
      if (options.preservePromptDraft !== true) {
        setPromptDraft(nextSnapshot.prompt.text)
      }
      setAutoApprove(nextSnapshot.settings.autoApprove)
      autoApproveDirtyRef.current = false
      setIsSetupOpen(nextSnapshot.prompt.text.length === 0)
      setError(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSavingSetup(false)
    }
  }, [autoApprove, postJson, promptDraft])

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
    autoApproveDirtyRef.current = true
    void saveSetup(nextPrompt, nextAutoApprove)
  }, [instructorPasscode, launchDefaults, launchDefaultsApplied, saveSetup, sessionId, snapshot])

  const handleSetupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveSetup()
  }

  const toggleAutoApprove = useCallback(() => {
    if (!snapshot) return
    autoApproveDirtyRef.current = true
    const nextAutoApprove = !autoApprove
    setAutoApprove(nextAutoApprove)
    void saveSetup(snapshot.prompt.text, nextAutoApprove, { preservePromptDraft: true })
  }, [autoApprove, saveSetup, snapshot])

  const handleInstructorPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = postDraft.trim()
    if (!text) return
    setIsPosting(true)
    try {
      await postJson('/posts', { text, styleId: postStyleId })
      setPostDraft('')
      await fetchState()
      setError(null)
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError))
    } finally {
      setIsPosting(false)
    }
  }

  const composeStyleClass = getNoteStyleClassName(postStyleId)

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
    const boardIds = snapshot.posts.filter((post) => post.status !== 'pending').map((post) => post.id)
    const index = boardIds.indexOf(postId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= boardIds.length) return
    const targetPostId = boardIds[targetIndex]
    if (targetPostId == null) return
    const reorderedIds = reorderPostIds(boardIds, postId, targetPostId)
    try {
      const nextSnapshot = await postJson('/reorder', { postIds: reorderedIds }) as PostboardInstructorSnapshot
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : String(reorderError))
    }
  }

  const dropPostOnTarget = async (targetPostId: string) => {
    const sourcePostId = draggedPostId
    setDraggedPostId(null)
    setDragOverPostId(null)
    if (!snapshot || !sourcePostId || sourcePostId === targetPostId) return
    const currentBoardIds = snapshot.posts.filter((post) => post.status !== 'pending').map((post) => post.id)
    const reorderedIds = reorderPostIds(currentBoardIds, sourcePostId, targetPostId)
    try {
      const nextSnapshot = await postJson('/reorder', { postIds: reorderedIds }) as PostboardInstructorSnapshot
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
  const boardPosts = snapshot?.posts.filter((post) => post.status !== 'pending') ?? []
  const showModerationQueue = !autoApprove || pendingPosts.length > 0

  return (
    <main className="postboard-shell">
      <SessionHeader
        activityName="Postboard"
        sessionId={sessionId}
        centerHeaderActions={(
          <div className="postboard-header-setup">
            <span className="postboard-header-prompt" title={snapshot?.prompt.text || 'No prompt set'}>
              {snapshot?.prompt.text || 'No prompt set'}
            </span>
            <button
              type="button"
              className="postboard-header-icon-button"
              onClick={() => setIsSetupOpen((open) => !open)}
              aria-expanded={isSetupOpen}
              aria-controls={isSetupOpen ? 'postboard-setup-form' : undefined}
              aria-label={isSetupOpen ? 'Close prompt editor' : 'Edit prompt'}
              title={isSetupOpen ? 'Close prompt editor' : 'Edit prompt'}
            >
              ✏️
            </button>
            <button
              type="button"
              role="switch"
              className="postboard-header-toggle"
              onClick={toggleAutoApprove}
              disabled={!snapshot || isSavingSetup}
              aria-checked={autoApprove}
              aria-label={autoApprove ? 'Auto-approve is on. Turn off to require moderation.' : 'Auto-approve is off. Turn on to skip moderation.'}
              title={autoApprove ? 'Auto-approve: on' : 'Auto-approve: off'}
            >
              <span className="postboard-header-toggle-label">Auto-approve</span>
              <span className="postboard-header-toggle-track" aria-hidden="true">
                <span className="postboard-header-toggle-thumb" />
              </span>
            </button>
          </div>
        )}
      />

      {error && <div className="postboard-alert" role="alert">{error}</div>}

      <div className="postboard-layout">
        <div className="postboard-main">
          {isSetupOpen && (
            <section className="postboard-panel" aria-label="Edit prompt">
              <form id="postboard-setup-form" className="postboard-form" onSubmit={handleSetupSubmit}>
                <label>
                  <span>Prompt text</span>
                  <textarea
                    value={promptDraft}
                    onChange={(event) => setPromptDraft(event.target.value)}
                    rows={3}
                    maxLength={1000}
                  />
                </label>
                <Button type="submit" disabled={isSavingSetup} aria-disabled={isSavingSetup}>
                  {isSavingSetup ? 'Saving...' : 'Save prompt'}
                </Button>
              </form>
            </section>
          )}

          <section className="postboard-panel" aria-labelledby="postboard-all-posts-title">
            <h2 id="postboard-all-posts-title">All Posts ({boardPosts.length})</h2>
            {snapshot == null ? (
              <p className="postboard-empty">Loading notes...</p>
            ) : boardPosts.length === 0 ? (
              <p className="postboard-empty">No board notes yet.</p>
            ) : null}
            <div className="postboard-board">
              {boardPosts.map((post, index) => {
                const isFaded = post.status === 'rejected' || post.status === 'deleted'
                return (
                <article
                  key={post.id}
                  className={`postboard-card postboard-card-with-flag ${getNoteStyleClassName(post.styleId)}${isFaded ? ' postboard-card-rejected' : ''}${draggedPostId === post.id ? ' postboard-card-dragging' : ''}${dragOverPostId === post.id && draggedPostId !== post.id ? ' postboard-card-drag-over' : ''}`}
                  draggable
                  onDragStart={(event) => {
                    setDraggedPostId(post.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', post.id)
                  }}
                  onDragOver={(event) => {
                    if (draggedPostId == null || draggedPostId === post.id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDragOverPostId(post.id)
                  }}
                  onDragLeave={() => {
                    setDragOverPostId((current) => (current === post.id ? null : current))
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void dropPostOnTarget(post.id)
                  }}
                  onDragEnd={() => {
                    setDraggedPostId(null)
                    setDragOverPostId(null)
                  }}
                >
                  <InstructorFeedbackControls
                    annotation={{
                      starred: false,
                      flagged: (snapshot?.flags[post.id]?.length ?? 0) > 0,
                      emoji: null,
                    }}
                    onToggleFlag={(flagged) => void runPostAction(post.id, 'flag', { flagged })}
                    className="postboard-flag-corner"
                  />
                  <div className="postboard-card-header">
                    <div className="postboard-card-titleline">
                      <p className="postboard-meta">{post.authorName}{post.hiddenAt != null ? ' · hidden' : ''}</p>
                      {post.status === 'rejected' && (
                        <span className="postboard-status-badge">
                          Rejected
                          <button
                            type="button"
                            onClick={() => void runPostAction(post.id, 'unreject')}
                            aria-label="Undo rejection"
                            title="Undo rejection"
                          >
                            ↻
                          </button>
                        </span>
                      )}
                      {post.status === 'deleted' && <span className="postboard-status-badge postboard-status-badge-muted">Deleted</span>}
                    </div>
                    <div className="postboard-move-actions">
                      <button type="button" onClick={() => void reorderPost(post.id, -1)} disabled={index === 0} aria-label="Move note up" title="Move note up">▲</button>
                      <button type="button" onClick={() => void reorderPost(post.id, 1)} disabled={index === boardPosts.length - 1} aria-label="Move note down" title="Move note down">▼</button>
                      {post.status === 'approved' && (
                        <button
                          type="button"
                          onClick={() => void runPostAction(post.id, post.hiddenAt == null ? 'hide' : 'unhide')}
                          aria-label={post.hiddenAt == null ? 'Hide note' : 'Unhide note'}
                          aria-pressed={post.hiddenAt != null}
                          title={post.hiddenAt == null ? 'Hide note' : 'Unhide note'}
                        >
                          {post.hiddenAt == null ? '👁️' : '🙈'}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className={isFaded ? 'postboard-card-fade' : undefined}>{post.text}</p>
                  <div className={`postboard-reactions${isFaded ? ' postboard-card-fade' : ''}`}>
                    <ReactionSummary
                      reactions={snapshot?.reactionCounts[post.id] ?? {}}
                      options={POSTBOARD_REACTION_OPTIONS}
                      viewerReaction={snapshot?.viewerReactions[post.id] ?? null}
                      canReact
                      onReact={(reactionId) => void reactToPost(post.id, reactionId as PostboardReactionId)}
                      triggerPosition="end"
                    />
                  </div>
                </article>
                )
              })}
            </div>
          </section>
        </div>

        <div className="postboard-side postboard-sticky-side">
          {showModerationQueue && (
            <section className="postboard-panel postboard-moderation-panel" aria-labelledby="postboard-moderation-title">
              <h2 id="postboard-moderation-title">Moderation Queue ({pendingPosts.length})</h2>
              {snapshot == null ? (
                <p className="postboard-empty">Loading notes...</p>
              ) : pendingPosts.length === 0 ? (
                <p className="postboard-empty">No pending notes.</p>
              ) : null}
              <div className="postboard-card-list">
                {pendingPosts.map((post) => (
                  <article key={post.id} className={`postboard-card ${getNoteStyleClassName(post.styleId)} postboard-card-pending`}>
                    <p>{post.text}</p>
                    <p className="postboard-meta">{post.authorName}</p>
                    <div className="postboard-actions">
                      <Button type="button" onClick={() => void runPostAction(post.id, 'approve')}>Approve</Button>
                      <Button type="button" onClick={() => void runPostAction(post.id, 'reject')}>Reject</Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="postboard-panel postboard-compose-panel" aria-labelledby="postboard-instructor-post-title">
            <h2 id="postboard-instructor-post-title">Add a note</h2>
            <form className="postboard-form" onSubmit={handleInstructorPost}>
              <label>
                <span className="postboard-sr-only">Instructor note</span>
                <div className={`note-style-field ${composeStyleClass}`}>
                  <textarea
                    value={postDraft}
                    onChange={(event) => setPostDraft(event.target.value)}
                    rows={3}
                    maxLength={1200}
                  />
                </div>
              </label>
              <div className="postboard-compose-actions">
                <NoteStyleSelect value={postStyleId} onChange={setPostStyleId} className="postboard-note-style-select" />
                <Button type="submit" disabled={isPosting || postDraft.trim().length === 0} aria-disabled={isPosting || postDraft.trim().length === 0}>
                  {isPosting ? 'Posting...' : 'Post note'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
