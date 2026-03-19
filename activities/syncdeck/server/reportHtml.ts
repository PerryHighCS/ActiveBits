import type {
  ActivityReportSummaryCard,
  SyncDeckSessionReportManifest,
} from '../../../types/activity.js'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString()
}

function sanitizeFileLabel(value: string): string {
  const collapsed = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const trimmed = collapsed.replace(/^-+|-+$/g, '')
  return trimmed.length > 0 ? trimmed : 'syncdeck-report'
}

function buildTopSummaryCards(manifest: SyncDeckSessionReportManifest): ActivityReportSummaryCard[] {
  return [
    {
      id: 'session-overview',
      title: 'Session Overview',
      metrics: [
        { id: 'activity-count', label: 'Embedded Activities', value: manifest.activities.length },
        { id: 'student-count', label: 'Students Represented', value: manifest.students.length },
      ],
    },
  ]
}

export function buildSyncDeckReportFilename(manifest: SyncDeckSessionReportManifest): string {
  return `${sanitizeFileLabel(`syncdeck-${manifest.parentSessionId}`)}.html`
}

export function buildSyncDeckSessionReportHtml(manifest: SyncDeckSessionReportManifest): string {
  const reportJson = toSafeJson(manifest)
  const topSummaryCards = buildTopSummaryCards(manifest)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(`SyncDeck Report ${manifest.parentSessionId}`)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --card: #ffffff;
      --ink: #14263a;
      --muted: #5f7284;
      --line: #d7e0e8;
      --accent: #0f5dc2;
      --accent-soft: #e8f1ff;
      --shadow: 0 12px 34px rgba(12, 33, 58, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(180deg, #eef4fb 0%, var(--bg) 220px);
      color: var(--ink);
    }
    .page {
      max-width: 1240px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    .hero, .panel, .card, .activity-card, .student-card {
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
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
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
    .summary-grid, .activity-grid, .student-grid {
      display: grid;
      gap: 14px;
    }
    .summary-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 18px; }
    .activity-grid, .student-grid { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .card, .activity-card, .student-card { padding: 16px; }
    .card h2, .activity-card h2, .student-card h2 { margin: 0 0 10px; font-size: 1.1rem; }
    .block-stack {
      display: grid;
      gap: 14px;
      margin-top: 16px;
    }
    .report-block {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: #fbfdff;
    }
    .report-block h3 {
      margin: 0 0 10px;
      font-size: 1rem;
    }
    .report-block p {
      margin: 0 0 10px;
      color: var(--ink);
      line-height: 1.5;
    }
    .report-block p:last-child {
      margin-bottom: 0;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 480px;
    }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .metrics {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: #fbfdff;
    }
    .metric-label {
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric-value {
      margin-top: 8px;
      font-size: 1.5rem;
      font-weight: 700;
    }
    .hidden { display: none !important; }
    .muted { color: var(--muted); }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 6px 10px;
      font-size: 0.82rem;
      font-weight: 700;
    }
    .section-list {
      margin: 0;
      padding-left: 18px;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 14px;
      padding: 18px;
      color: var(--muted);
      background: #fcfdff;
    }
    @media print {
      body { background: white; }
      .page { max-width: none; padding: 0; }
      .hero, .panel, .card, .activity-card, .student-card { box-shadow: none; }
      .toolbar { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="eyebrow">SyncDeck Session Report</div>
      <h1>${escapeHtml(`Session ${manifest.parentSessionId}`)}</h1>
      <div class="meta">
        <span>Generated: ${escapeHtml(formatDate(manifest.generatedAt))}</span>
        <span>Embedded activities: ${manifest.activities.length}</span>
        <span>Students represented: ${manifest.students.length}</span>
      </div>
    </section>

    <section class="panel" style="padding: 18px;">
      <div class="toolbar">
        <div class="tabs" role="toolbar" aria-label="Report views">
          <button type="button" class="tab" data-view="summary" aria-pressed="true">Session Summary</button>
          <button type="button" class="tab" data-view="activities" aria-pressed="false">By Activity</button>
          <button type="button" class="tab" data-view="students" aria-pressed="false">By Student</button>
        </div>
        <label id="student-picker-label" class="hidden">
          Student
          <select id="student-picker" aria-labelledby="student-picker-label"></select>
        </label>
      </div>

      <div id="summary-view">
        <div class="summary-grid" id="summary-grid"></div>
        <div class="block-stack" id="summary-block-grid"></div>
      </div>

      <div id="activities-view" class="hidden">
        <div class="activity-grid" id="activity-grid"></div>
      </div>

      <div id="students-view" class="hidden">
        <div class="student-grid" id="student-grid"></div>
      </div>
    </section>
  </div>

  <script id="report-data" type="application/json">${reportJson}</script>
  <script>
    (() => {
      const manifest = JSON.parse(document.getElementById('report-data').textContent || '{}');
      const summaryGrid = document.getElementById('summary-grid');
      const activityGrid = document.getElementById('activity-grid');
      const studentGrid = document.getElementById('student-grid');
      const summaryBlockGrid = document.getElementById('summary-block-grid');
      const studentPicker = document.getElementById('student-picker');
      const studentPickerLabel = document.getElementById('student-picker-label');
      const summaryView = document.getElementById('summary-view');
      const activitiesView = document.getElementById('activities-view');
      const studentsView = document.getElementById('students-view');
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
      const activities = Array.isArray(manifest.activities) ? manifest.activities : [];
      const students = Array.isArray(manifest.students) ? manifest.students : [];

      const topCards = ${toSafeJson(topSummaryCards)};
      const renderBlocks = (blocks) => {
        if (!Array.isArray(blocks) || blocks.length === 0) {
          return '';
        }

        return blocks.map((block) => {
          if (!block || typeof block !== 'object') {
            return '';
          }

          const title = typeof block.title === 'string' && block.title.length > 0
            ? '<h3>' + escapeText(block.title) + '</h3>'
            : '';

          if (block.type === 'rich-text') {
            const paragraphs = Array.isArray(block.paragraphs) ? block.paragraphs : [];
            return '<section class="report-block">' + title +
              (paragraphs.length > 0
                ? paragraphs.map((paragraph) => '<p>' + escapeText(paragraph) + '</p>').join('')
                : '<div class="empty">No details were provided for this section.</div>') +
              '</section>';
          }

          if (block.type === 'table') {
            const columns = Array.isArray(block.columns) ? block.columns : [];
            const rows = Array.isArray(block.rows) ? block.rows : [];
            const emptyMessage = typeof block.emptyMessage === 'string' && block.emptyMessage.length > 0
              ? block.emptyMessage
              : 'No rows were available for this section.';

            return '<section class="report-block">' + title +
              (rows.length > 0
                ? '<div class="table-wrap"><table><thead><tr>' +
                    columns.map((column) => '<th scope="col">' + escapeText(column) + '</th>').join('') +
                  '</tr></thead><tbody>' +
                    rows.map((row) => {
                      const cells = Array.isArray(row && row.cells) ? row.cells : [];
                      return '<tr>' + cells.map((cell) => '<td>' + escapeText(cell) + '</td>').join('') + '</tr>';
                    }).join('') +
                  '</tbody></table></div>'
                : '<div class="empty">' + escapeText(emptyMessage) + '</div>') +
              '</section>';
          }

          return '';
        }).join('');
      };

      summaryGrid.innerHTML = topCards.map((card) =>
        '<section class="card"><h2>' + escapeText(card.title) + '</h2><div class="metrics">' +
        (Array.isArray(card.metrics) ? card.metrics.map((metric) =>
          '<div class="metric"><div class="metric-label">' + escapeText(metric.label) + '</div><div class="metric-value">' + escapeText(metric.value) + '</div></div>'
        ).join('') : '') +
        '</div></section>'
      ).join('');
      summaryBlockGrid.innerHTML = activities.map((activity) => {
        const scopeBlocks = activity.report && activity.report.scopeBlocks && activity.report.scopeBlocks['session-summary'];
        if (!Array.isArray(scopeBlocks) || scopeBlocks.length === 0) {
          return '';
        }

        return '<article class="card">' +
          '<div class="badge">' + escapeText(activity.activityName || activity.activityId) + '</div>' +
          '<h2>' + escapeText(activity.report && activity.report.title ? activity.report.title : activity.instanceKey) + '</h2>' +
          renderBlocks(scopeBlocks) +
        '</article>';
      }).join('');

      activityGrid.innerHTML = activities.length === 0
        ? '<div class="empty">No embedded activity reports were available for this session.</div>'
        : activities.map((activity) => {
            const summaryCards = Array.isArray(activity.report && activity.report.summaryCards) ? activity.report.summaryCards : [];
            const studentsForActivity = Array.isArray(activity.report && activity.report.students) ? activity.report.students : [];
            const scopeBlocks = activity.report && activity.report.scopeBlocks && activity.report.scopeBlocks['activity-session'];
            return '<article class="activity-card">' +
              '<div class="badge">' + escapeText(activity.activityName || activity.activityId) + '</div>' +
              '<h2>' + escapeText(activity.report && activity.report.title ? activity.report.title : activity.instanceKey) + '</h2>' +
              '<p class="muted">Instance: ' + escapeText(activity.instanceKey) + '</p>' +
              '<p class="muted">Started: ' + escapeText(formatDate(activity.startedAt)) + '</p>' +
              (
                summaryCards.length > 0
                  ? summaryCards.map((card) =>
                      '<section style="margin-top:14px;"><h3>' + escapeText(card.title) + '</h3><div class="metrics">' +
                      (Array.isArray(card.metrics) ? card.metrics.map((metric) =>
                        '<div class="metric"><div class="metric-label">' + escapeText(metric.label) + '</div><div class="metric-value">' + escapeText(metric.value) + '</div></div>'
                      ).join('') : '') +
                      '</div></section>'
                    ).join('')
                  : '<div class="empty" style="margin-top:14px;">No summary cards were provided for this activity.</div>'
              ) +
              renderBlocks(scopeBlocks) +
              '<section style="margin-top:14px;"><h3>Students in this activity</h3>' +
              (
                studentsForActivity.length > 0
                  ? '<ul class="section-list">' + studentsForActivity.map((student) =>
                      '<li>' + escapeText(student.displayName || student.studentId) + '</li>'
                    ).join('') + '</ul>'
                  : '<div class="empty">No student data available for this activity.</div>'
              ) +
              '</section></article>';
          }).join('');

      studentPicker.innerHTML = students.map((student) =>
        '<option value="' + escapeText(student.studentId) + '">' + escapeText(student.displayName || student.studentId) + '</option>'
      ).join('');

      const renderStudent = (studentId) => {
        const student = students.find((entry) => entry.studentId === studentId) || null;
        const relevantActivities = activities.filter((activity) =>
          Array.isArray(activity.report && activity.report.students)
          && activity.report.students.some((entry) => entry.studentId === studentId)
        );

        studentGrid.innerHTML = !student
          ? '<div class="empty">No student data available.</div>'
          : (
            '<article class="student-card">' +
              '<div class="badge">Student</div>' +
              '<h2>' + escapeText(student.displayName || student.studentId) + '</h2>' +
              '<p class="muted">Student ID: ' + escapeText(student.studentId) + '</p>' +
              '<section style="margin-top:14px;"><h3>Activities represented</h3>' +
                (
                  relevantActivities.length > 0
                    ? '<ul class="section-list">' + relevantActivities.map((activity) =>
                        '<li><strong>' + escapeText(activity.activityName || activity.activityId) + '</strong> <span class="muted">(' + escapeText(activity.instanceKey) + ')</span></li>'
                      ).join('') + '</ul>'
                    : '<div class="empty">This student does not appear in any aggregated embedded activity reports.</div>'
                ) +
              '</section>' +
            '</article>' +
            relevantActivities.map((activity) => {
              const summaryCards = Array.isArray(activity.report && activity.report.summaryCards) ? activity.report.summaryCards : [];
              const studentScopeBlocks = activity.report
                && activity.report.studentScopeBlocks
                && activity.report.studentScopeBlocks[studentId];
              return '<article class="student-card">' +
                '<div class="badge">' + escapeText(activity.activityName || activity.activityId) + '</div>' +
                '<h2>' + escapeText(activity.report && activity.report.title ? activity.report.title : activity.instanceKey) + '</h2>' +
                (
                  summaryCards.length > 0
                    ? summaryCards.map((card) =>
                        '<section style="margin-top:14px;"><h3>' + escapeText(card.title) + '</h3><div class="metrics">' +
                        (Array.isArray(card.metrics) ? card.metrics.map((metric) =>
                          '<div class="metric"><div class="metric-label">' + escapeText(metric.label) + '</div><div class="metric-value">' + escapeText(metric.value) + '</div></div>'
                        ).join('') : '') +
                        '</div></section>'
                      ).join('')
                    : '<div class="empty" style="margin-top:14px;">No summary cards were provided for this activity.</div>'
                ) +
                renderBlocks(studentScopeBlocks) +
              '</article>';
            }).join('')
          );
      };

      const setView = (view) => {
        summaryView.classList.toggle('hidden', view !== 'summary');
        activitiesView.classList.toggle('hidden', view !== 'activities');
        studentsView.classList.toggle('hidden', view !== 'students');
        studentPickerLabel.classList.toggle('hidden', view !== 'students' || students.length === 0);
        tabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
        if (view === 'students') {
          renderStudent(studentPicker.value || (students[0] && students[0].studentId) || '');
        }
      };

      tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view || 'summary')));
      studentPicker.addEventListener('change', () => renderStudent(studentPicker.value));
      if (students.length > 0) {
        studentPicker.value = students[0].studentId;
      }
      setView('summary');
    })();
  </script>
</body>
</html>`
}
