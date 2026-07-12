import escapeHtmlString from 'escape-html'
import type {
  ActivityReportBlock,
  ActivityReportStudentRef,
  ActivityReportSummaryCard,
  ActivityReportTableRow,
  ActivityStructuredReportSection,
} from '../../../types/activity.js'
import type {
  PostboardFlag,
  PostboardPost,
  PostboardPostStatus,
  PostboardPrompt,
  PostboardReactionCounts,
  PostboardSessionData,
  PostboardSettings,
} from '../shared/types.js'
import { POSTBOARD_REACTION_OPTIONS } from '../shared/types.js'
import { NOTE_STYLE_OPTIONS } from '../../shared/noteStyles.js'

export interface PostboardReportBundle {
  version: 1
  exportedAt: number
  sessionId: string
  prompt: PostboardPrompt
  settings: PostboardSettings
  posts: PostboardPost[]
  reactionCounts: PostboardReactionCounts
  flags: Record<string, PostboardFlag[]>
  stats: {
    totalPosts: number
    approvedPosts: number
    pendingPosts: number
    rejectedPosts: number
    deletedPosts: number
    hiddenPosts: number
    totalReactions: number
    flaggedPosts: number
  }
}

const STATUS_LABELS: Record<PostboardPostStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  deleted: 'Deleted',
}

const STYLE_LABELS = NOTE_STYLE_OPTIONS.reduce<Record<string, string>>((accumulator, option) => {
  accumulator[option.id] = option.label
  return accumulator
}, {})

function countPosts(posts: readonly PostboardPost[], status: PostboardPostStatus): number {
  return posts.filter((post) => post.status === status).length
}

function countReactions(reactionCounts: PostboardReactionCounts): number {
  return Object.values(reactionCounts).reduce((total, counts) => (
    total + Object.values(counts).reduce((postTotal, count) => postTotal + (count ?? 0), 0)
  ), 0)
}

function sortPosts(posts: readonly PostboardPost[]): PostboardPost[] {
  return [...posts].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order
    return left.createdAt - right.createdAt
  })
}

function formatReactionCounts(counts: PostboardReactionCounts[string] | undefined): string {
  if (!counts) return 'None'
  const parts = POSTBOARD_REACTION_OPTIONS
    .map((reaction) => {
      const count = counts[reaction.value]
      return typeof count === 'number' && count > 0 ? `${reaction.symbol} ${count}` : null
    })
    .filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : 'None'
}

function formatFlags(flags: PostboardFlag[] | undefined): string {
  if (!flags || flags.length === 0) return 'None'
  return flags
    .map((flag) => flag.reason ? flag.reason : `Flagged by ${flag.flaggedBy}`)
    .join('; ')
}

function formatDate(timestamp: number | null): string {
  if (timestamp == null) return 'N/A'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString()
}

export function buildPostboardReportBundle(params: {
  sessionId: string
  data: PostboardSessionData
  reactionCounts: PostboardReactionCounts
}): PostboardReportBundle {
  const posts = sortPosts(params.data.posts)
  const hiddenPosts = posts.filter((post) => post.hiddenAt != null).length
  return {
    version: 1,
    exportedAt: Date.now(),
    sessionId: params.sessionId,
    prompt: params.data.prompt,
    settings: params.data.settings,
    posts,
    reactionCounts: params.reactionCounts,
    flags: params.data.flags,
    stats: {
      totalPosts: posts.length,
      approvedPosts: countPosts(posts, 'approved'),
      pendingPosts: countPosts(posts, 'pending'),
      rejectedPosts: countPosts(posts, 'rejected'),
      deletedPosts: countPosts(posts, 'deleted'),
      hiddenPosts,
      totalReactions: countReactions(params.reactionCounts),
      flaggedPosts: Object.keys(params.data.flags).length,
    },
  }
}

function toReportStudents(bundle: PostboardReportBundle): ActivityReportStudentRef[] {
  const byStudentId = new Map<string, ActivityReportStudentRef>()
  for (const post of bundle.posts) {
    if (post.authorRole !== 'student') continue
    if (!byStudentId.has(post.authorId)) {
      byStudentId.set(post.authorId, {
        studentId: post.authorId,
        displayName: post.authorName,
      })
    }
  }
  return [...byStudentId.values()]
}

function toSummaryCards(bundle: PostboardReportBundle): ActivityReportSummaryCard[] {
  return [
    {
      id: 'postboard-overview',
      title: 'Postboard Overview',
      metrics: [
        { id: 'total-posts', label: 'Posts', value: bundle.stats.totalPosts },
        { id: 'approved-posts', label: 'Approved', value: bundle.stats.approvedPosts },
        { id: 'pending-posts', label: 'Pending', value: bundle.stats.pendingPosts },
        { id: 'rejected-posts', label: 'Rejected', value: bundle.stats.rejectedPosts },
        { id: 'reactions', label: 'Reactions', value: bundle.stats.totalReactions },
        { id: 'flagged-posts', label: 'Flagged Posts', value: bundle.stats.flaggedPosts },
      ],
    },
  ]
}

function buildPostRows(bundle: PostboardReportBundle, posts: readonly PostboardPost[]): ActivityReportTableRow[] {
  return posts.map((post) => ({
    id: post.id,
    cells: [
      post.authorName,
      post.authorRole === 'instructor' ? 'Instructor' : 'Student',
      post.text,
      STATUS_LABELS[post.status],
      STYLE_LABELS[post.styleId] ?? post.styleId,
      formatReactionCounts(bundle.reactionCounts[post.id]),
      formatFlags(bundle.flags[post.id]),
      post.hiddenAt == null ? 'Visible' : `Hidden ${formatDate(post.hiddenAt)}`,
    ],
  }))
}

function buildScopeBlocks(bundle: PostboardReportBundle): Partial<Record<'activity-session' | 'session-summary', ActivityReportBlock[]>> {
  return {
    'session-summary': [
      {
        id: 'postboard-session-summary',
        type: 'rich-text',
        title: 'Snapshot',
        paragraphs: [
          bundle.prompt.text
            ? `Prompt: ${bundle.prompt.text}`
            : 'No prompt text was set for this Postboard session.',
          `Auto-approve was ${bundle.settings.autoApprove ? 'enabled' : 'disabled'}.`,
          `${bundle.stats.approvedPosts} approved post${bundle.stats.approvedPosts === 1 ? '' : 's'}, ${bundle.stats.pendingPosts} pending, ${bundle.stats.rejectedPosts} rejected, and ${bundle.stats.deletedPosts} deleted.`,
        ],
      },
    ],
    'activity-session': [
      {
        id: 'postboard-post-log',
        type: 'table',
        title: 'Post Log',
        columns: ['Author', 'Role', 'Post', 'Status', 'Style', 'Reactions', 'Flags', 'Visibility'],
        rows: buildPostRows(bundle, bundle.posts),
        emptyMessage: 'No posts were captured for this Postboard session.',
      },
    ],
  }
}

function buildStudentScopeBlocks(bundle: PostboardReportBundle): Record<string, ActivityReportBlock[]> {
  const blocks: Record<string, ActivityReportBlock[]> = {}
  for (const student of toReportStudents(bundle)) {
    const studentPosts = bundle.posts.filter((post) => post.authorRole === 'student' && post.authorId === student.studentId)
    blocks[student.studentId] = [
      {
        id: `postboard-student-summary-${student.studentId}`,
        type: 'rich-text',
        title: 'Student Snapshot',
        paragraphs: [
          `${student.displayName ?? student.studentId} contributed ${studentPosts.length} post${studentPosts.length === 1 ? '' : 's'}.`,
        ],
      },
      {
        id: `postboard-student-posts-${student.studentId}`,
        type: 'table',
        title: 'Posts',
        columns: ['Author', 'Role', 'Post', 'Status', 'Style', 'Reactions', 'Flags', 'Visibility'],
        rows: buildPostRows(bundle, studentPosts),
        emptyMessage: 'No posts were captured for this student.',
      },
    ]
  }
  return blocks
}

export function buildPostboardStructuredReportSection(
  bundle: PostboardReportBundle,
  params: { instanceKey: string },
): ActivityStructuredReportSection {
  return {
    activityId: 'postboard',
    childSessionId: bundle.sessionId,
    instanceKey: params.instanceKey,
    title: bundle.prompt.text ? `Postboard: ${bundle.prompt.text}` : 'Postboard Report',
    generatedAt: bundle.exportedAt,
    reportStatus: 'available',
    supportsScopes: ['activity-session', 'student-cross-activity', 'session-summary'],
    students: toReportStudents(bundle),
    summaryCards: toSummaryCards(bundle),
    scopeBlocks: buildScopeBlocks(bundle),
    studentScopeBlocks: buildStudentScopeBlocks(bundle),
    payload: {
      report: bundle,
    },
  }
}

function escapeHtml(value: unknown): string {
  return escapeHtmlString(String(value ?? ''))
}

function toSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

function sanitizeFileLabel(value: string): string {
  const collapsed = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const trimmed = collapsed.replace(/^-+|-+$/g, '')
  return trimmed.length > 0 ? trimmed : 'postboard-report'
}

export function buildPostboardReportFilename(bundle: PostboardReportBundle): string {
  const label = bundle.prompt.text || `postboard-${bundle.sessionId}`
  return `${sanitizeFileLabel(label).slice(0, 80)}.html`
}

export function buildPostboardReportHtml(bundle: PostboardReportBundle): string {
  const reportJson = toSafeJson(bundle)
  const postRows = buildPostRows(bundle, bundle.posts)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(bundle.prompt.text ? `Postboard Report - ${bundle.prompt.text}` : 'Postboard Report')}</title>
  <style>
    :root { color-scheme: light; --bg: #f5f7fb; --card: #fff; --ink: #172033; --muted: #617086; --line: #d8e0ea; --accent: #0f766e; --soft: #e8f5f2; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--ink); }
    .page { max-width: 1180px; margin: 0 auto; padding: 28px 20px 48px; }
    .hero, .panel { background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 12px 30px rgba(18, 38, 63, .08); }
    .hero { padding: 24px; margin-bottom: 18px; }
    .eyebrow { color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
    h1 { margin: 8px 0 10px; font-size: 2rem; line-height: 1.15; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 18px; color: var(--muted); font-size: .95rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
    .stat { background: var(--soft); border: 1px solid #bfe3dd; border-radius: 8px; padding: 12px; }
    .stat-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .stat-value { margin-top: 6px; font-size: 1.5rem; font-weight: 700; }
    .panel { padding: 18px; overflow-x: auto; }
    table { width: 100%; min-width: 900px; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; padding: 16px; }
    @media print { body { background: white; } .page { max-width: none; padding: 0; } .hero, .panel { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="eyebrow">Postboard Report</div>
      <h1>${escapeHtml(bundle.prompt.text || 'Untitled Prompt')}</h1>
      <div class="meta">
        <span>Session: ${escapeHtml(bundle.sessionId)}</span>
        <span>Exported: ${escapeHtml(formatDate(bundle.exportedAt))}</span>
        <span>Auto-approve: ${bundle.settings.autoApprove ? 'enabled' : 'disabled'}</span>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Posts</div><div class="stat-value">${bundle.stats.totalPosts}</div></div>
        <div class="stat"><div class="stat-label">Approved</div><div class="stat-value">${bundle.stats.approvedPosts}</div></div>
        <div class="stat"><div class="stat-label">Pending</div><div class="stat-value">${bundle.stats.pendingPosts}</div></div>
        <div class="stat"><div class="stat-label">Rejected</div><div class="stat-value">${bundle.stats.rejectedPosts}</div></div>
        <div class="stat"><div class="stat-label">Reactions</div><div class="stat-value">${bundle.stats.totalReactions}</div></div>
        <div class="stat"><div class="stat-label">Flagged</div><div class="stat-value">${bundle.stats.flaggedPosts}</div></div>
      </div>
    </section>
    <section class="panel">
      ${postRows.length === 0
        ? '<div class="empty">No posts were captured for this Postboard session.</div>'
        : `<table>
          <thead><tr><th>Author</th><th>Role</th><th>Post</th><th>Status</th><th>Style</th><th>Reactions</th><th>Flags</th><th>Visibility</th></tr></thead>
          <tbody>${postRows.map((row) => `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>`}
    </section>
  </div>
  <script id="postboard-report-data" type="application/json">${reportJson}</script>
</body>
</html>`
}
