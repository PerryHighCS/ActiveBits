interface RevieweeRecord {
  name: string
  projectTitle?: string | null
}

interface ReviewerRecord {
  name: string
}

interface FeedbackEntry {
  id: string
  to: string
  from: string
  fromNameSnapshot: string
  message: string
  createdAt: number
  styleId: string
}

interface GalleryStats {
  reviewees: Record<string, number>
  reviewers: Record<string, number>
}

export interface GalleryWalkReportBundle {
  version: 1
  exportedAt: number
  sessionId: string
  reviewees: Record<string, RevieweeRecord>
  reviewers: Record<string, ReviewerRecord>
  feedback: FeedbackEntry[]
  stats: GalleryStats
  stage: 'gallery' | 'review'
  config: Record<string, unknown> & { title?: string }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizeFileLabel(value: string): string {
  const collapsed = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const trimmed = collapsed.replace(/^-+|-+$/g, '')
  return trimmed.length > 0 ? trimmed : 'gallery-walk-report'
}

export function buildGalleryWalkReportFilename(bundle: GalleryWalkReportBundle): string {
  const title = typeof bundle.config.title === 'string' && bundle.config.title.trim().length > 0
    ? bundle.config.title
    : `gallery-walk-${bundle.sessionId}`
  return `${sanitizeFileLabel(title)}.html`
}

function formatExportedAt(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown export time' : date.toLocaleString()
}

function toSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

export function buildGalleryWalkReportHtml(bundle: GalleryWalkReportBundle): string {
  const title = typeof bundle.config.title === 'string' && bundle.config.title.trim().length > 0
    ? bundle.config.title.trim()
    : 'Gallery Walk Report'
  const revieweeCount = Object.keys(bundle.reviewees).length
  const reviewerCount = Object.keys(bundle.reviewers).length
  const feedbackCount = bundle.feedback.length
  const reportJson = toSafeJson(bundle)
  const exportedAtLabel = formatExportedAt(bundle.exportedAt)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f7fb;
      --card: #ffffff;
      --ink: #15304a;
      --muted: #5a7288;
      --line: #d6e1eb;
      --accent: #1064c4;
      --accent-soft: #e8f1ff;
      --good: #16794f;
      --shadow: 0 14px 38px rgba(10, 40, 70, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(180deg, #eef5fb 0%, var(--bg) 220px);
      color: var(--ink);
    }
    .page {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    .hero, .panel, .table-wrap, .notes {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }
    .hero {
      padding: 24px;
      margin-bottom: 20px;
    }
    .eyebrow {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--accent);
      font-weight: 700;
    }
    h1 {
      margin: 8px 0 10px;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1.05;
    }
    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin: 20px 0;
    }
    .stat {
      padding: 16px;
      border-radius: 16px;
      background: #f9fbfd;
      border: 1px solid var(--line);
    }
    .stat-label {
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stat-value {
      margin-top: 8px;
      font-size: 1.9rem;
      font-weight: 700;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tab {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 999px;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .tab[aria-pressed="true"] {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent);
    }
    label {
      font-size: 0.9rem;
      color: var(--muted);
      font-weight: 600;
    }
    select {
      margin-left: 8px;
      min-width: 240px;
      max-width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      background: white;
      color: var(--ink);
    }
    .panel {
      padding: 18px;
      margin-bottom: 16px;
    }
    .panel h2, .notes h2 {
      margin: 0 0 10px;
      font-size: 1.2rem;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
    }
    .summary-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: #fbfdff;
    }
    .summary-card h3 {
      margin: 0 0 8px;
      font-size: 1rem;
    }
    .summary-card ol, .summary-card ul {
      margin: 0;
      padding-left: 18px;
    }
    .table-wrap {
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f7fbff;
      font-size: 0.84rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    td small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
    }
    .notes {
      padding: 18px;
    }
    .note-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .note {
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      background: linear-gradient(180deg, #fffdf7 0%, #fff 100%);
    }
    .note strong {
      display: block;
      margin-bottom: 8px;
    }
    .note-meta {
      margin-top: 10px;
      font-size: 0.86rem;
      color: var(--muted);
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 14px;
      padding: 20px;
      color: var(--muted);
      background: #fcfdff;
    }
    .hidden { display: none !important; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media print {
      body { background: white; }
      .page { max-width: none; padding: 0; }
      .hero, .panel, .table-wrap, .notes { box-shadow: none; }
      .controls { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="eyebrow">Gallery Walk Report</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="hero-meta">
        <span>Session: ${escapeHtml(bundle.sessionId)}</span>
        <span>Exported: ${escapeHtml(exportedAtLabel)}</span>
        <span>Stage at export: ${escapeHtml(bundle.stage)}</span>
      </div>
      <div class="stats" aria-label="Report summary">
        <div class="stat"><div class="stat-label">Feedback Entries</div><div class="stat-value">${feedbackCount}</div></div>
        <div class="stat"><div class="stat-label">Students Reviewed</div><div class="stat-value">${revieweeCount}</div></div>
        <div class="stat"><div class="stat-label">Reviewers</div><div class="stat-value">${reviewerCount}</div></div>
      </div>
    </section>

    <section class="panel">
      <div class="controls">
        <div class="tabs" role="toolbar" aria-label="Report views">
          <button type="button" class="tab" data-view="summary" aria-pressed="true">Whole Class</button>
          <button type="button" class="tab" data-view="student" aria-pressed="false">Per Student</button>
        </div>
        <label id="student-picker-label" class="hidden">
          Student
          <select id="student-picker" aria-labelledby="student-picker-label"></select>
        </label>
      </div>

      <div id="summary-view">
        <div class="summary-grid" id="summary-grid"></div>
      </div>

      <div id="student-view" class="hidden">
        <div class="panel" style="margin-bottom: 16px;">
          <h2 id="student-heading">Student Details</h2>
          <div id="student-meta" class="hero-meta"></div>
        </div>
        <section class="notes">
          <h2>Feedback Notes</h2>
          <div id="student-notes"></div>
        </section>
      </div>
    </section>
  </div>

  <script id="report-data" type="application/json">${reportJson}</script>
  <script>
    (() => {
      const data = JSON.parse(document.getElementById('report-data').textContent || '{}');
      const reviewees = data.reviewees || {};
      const reviewers = data.reviewers || {};
      const feedback = Array.isArray(data.feedback) ? data.feedback.slice() : [];
      feedback.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const summaryGrid = document.getElementById('summary-grid');
      const studentPickerLabel = document.getElementById('student-picker-label');
      const studentPicker = document.getElementById('student-picker');
      const summaryView = document.getElementById('summary-view');
      const studentView = document.getElementById('student-view');
      const studentHeading = document.getElementById('student-heading');
      const studentMeta = document.getElementById('student-meta');
      const studentNotes = document.getElementById('student-notes');
      const tabs = Array.from(document.querySelectorAll('.tab'));

      const formatDate = (value) => {
        const date = new Date(value || 0);
        return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
      };
      const escapeText = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
      const stripUnsafe = (value) => String(value || '').replace(/[&<>"']/g, '');

      const getRevieweeLabel = (revieweeId) => {
        const reviewee = reviewees[revieweeId] || {};
        if (reviewee.projectTitle && reviewee.name) return reviewee.name + ' - ' + reviewee.projectTitle;
        return reviewee.name || reviewee.projectTitle || revieweeId;
      };

      const getReviewerLabel = (entry) => {
        return entry.fromNameSnapshot || (reviewers[entry.from] && reviewers[entry.from].name) || entry.from || 'Anonymous Reviewer';
      };

      const grouped = Object.keys(reviewees).map((revieweeId) => {
        const entries = feedback.filter((entry) => entry.to === revieweeId);
        return {
          revieweeId,
          label: getRevieweeLabel(revieweeId),
          feedbackCount: entries.length,
          entries,
          uniqueReviewers: Array.from(new Set(entries.map((entry) => getReviewerLabel(entry)))).filter(Boolean),
        };
      }).sort((a, b) => b.feedbackCount - a.feedbackCount || a.label.localeCompare(b.label));

      const topReviewers = Object.entries(data.stats && data.stats.reviewers ? data.stats.reviewers : {})
        .map(([reviewerId, count]) => ({
          reviewerId,
          label: (reviewers[reviewerId] && reviewers[reviewerId].name) || reviewerId,
          count,
        }))
        .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));

      const summaryCards = [
        {
          title: 'Students by feedback received',
          content: grouped.length === 0
            ? '<div class="empty">No feedback has been collected yet.</div>'
            : '<ol>' + grouped.map((entry) => '<li><strong>' + entry.label + '</strong><br><small>' + entry.feedbackCount + ' note' + (entry.feedbackCount === 1 ? '' : 's') + '</small></li>').join('') + '</ol>',
        },
        {
          title: 'Reviewers by notes given',
          content: topReviewers.length === 0
            ? '<div class="empty">No reviewer activity has been recorded yet.</div>'
            : '<ol>' + topReviewers.map((entry) => '<li><strong>' + entry.label + '</strong><br><small>' + entry.count + ' note' + (entry.count === 1 ? '' : 's') + '</small></li>').join('') + '</ol>',
        },
      ];

      const tableRows = feedback.length === 0
        ? '<div class="empty">No feedback entries were present in this session.</div>'
        : '<div class="table-wrap"><table><thead><tr><th>Student</th><th>Reviewer</th><th>Message</th><th>Time</th></tr></thead><tbody>' +
            feedback.map((entry) =>
              '<tr>' +
                '<td><strong>' + getRevieweeLabel(entry.to) + '</strong><small>' + (entry.to || '') + '</small></td>' +
                '<td>' + getReviewerLabel(entry) + '</td>' +
                '<td>' + escapeText(entry.message) + '</td>' +
                '<td>' + formatDate(entry.createdAt) + '</td>' +
              '</tr>'
            ).join('') +
          '</tbody></table></div>';

      summaryCards.push({
        title: 'All activity feedback',
        content: tableRows,
      });

      summaryGrid.innerHTML = summaryCards
        .map((card) => '<section class="summary-card"><h3>' + card.title + '</h3>' + card.content + '</section>')
        .join('');

      studentPicker.innerHTML = grouped
        .map((entry) => '<option value="' + stripUnsafe(entry.revieweeId) + '">' + escapeText(entry.label) + '</option>')
        .join('');

      const renderStudent = (revieweeId) => {
        const selected = grouped.find((entry) => entry.revieweeId === revieweeId) || null;
        if (!selected) {
          studentHeading.textContent = 'Student Details';
          studentMeta.innerHTML = '';
          studentNotes.innerHTML = '<div class="empty">No student data available in this report.</div>';
          return;
        }

        studentHeading.textContent = selected.label;
        studentMeta.innerHTML = [
          '<span>' + selected.feedbackCount + ' feedback note' + (selected.feedbackCount === 1 ? '' : 's') + '</span>',
          '<span>' + selected.uniqueReviewers.length + ' unique reviewer' + (selected.uniqueReviewers.length === 1 ? '' : 's') + '</span>',
          '<span>Reviewee ID: ' + selected.revieweeId + '</span>',
        ].join('');

        if (selected.entries.length === 0) {
          studentNotes.innerHTML = '<div class="empty">No feedback notes were captured for this student.</div>';
          return;
        }

        studentNotes.innerHTML = '<div class="note-grid">' + selected.entries.map((entry) =>
          '<article class="note">' +
            '<strong>' + getReviewerLabel(entry) + '</strong>' +
            '<div>' + escapeText(entry.message) + '</div>' +
            '<div class="note-meta">' + formatDate(entry.createdAt) + '</div>' +
          '</article>'
        ).join('') + '</div>';
      };

      const setView = (view) => {
        const showStudent = view === 'student';
        summaryView.classList.toggle('hidden', showStudent);
        studentView.classList.toggle('hidden', !showStudent);
        studentPickerLabel.classList.toggle('hidden', !showStudent || grouped.length === 0);
        tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
        if (showStudent) {
          renderStudent(studentPicker.value || (grouped[0] && grouped[0].revieweeId) || '');
        }
      };

      tabs.forEach((tab) => {
        tab.addEventListener('click', () => setView(tab.dataset.view || 'summary'));
      });

      studentPicker.addEventListener('change', () => {
        renderStudent(studentPicker.value);
      });

      if (grouped.length > 0) {
        studentPicker.value = grouped[0].revieweeId;
      }
      setView('summary');
    })();
  </script>
</body>
</html>`
}
