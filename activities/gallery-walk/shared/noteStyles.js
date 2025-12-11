export const NOTE_STYLE_OPTIONS = [
  { id: 'lemon', label: 'Lemon', className: 'note-style-lemon', previewColor: '#fdecc8' },
  { id: 'peach', label: 'Peach', className: 'note-style-peach', previewColor: '#ffe7f1' },
  { id: 'sky', label: 'Sky', className: 'note-style-sky', previewColor: '#e7f6fd' },
  { id: 'mint', label: 'Mint', className: 'note-style-mint', previewColor: '#e8f5c8' },
  { id: 'lavender', label: 'Lavender', className: 'note-style-lavender', previewColor: '#f0e6ff' },
  { id: 'checker', label: 'Checker', className: 'note-style-checker', previewColor: '#fdecc8' },
  { id: 'diagonal', label: 'Diagonal', className: 'note-style-diagonal', previewColor: '#ffe7f1' },
  { id: 'vertical', label: 'Stripes', className: 'note-style-vertical', previewColor: '#e7f6fd' },
  { id: 'dots', label: 'Dots', className: 'note-style-dots', previewColor: '#f0e6ff' },
  { id: 'grid', label: 'Grid', className: 'note-style-grid', previewColor: '#e8f5c8' },
];

export const DEFAULT_NOTE_STYLE_ID = NOTE_STYLE_OPTIONS[0].id;

const STYLE_MAP = NOTE_STYLE_OPTIONS.reduce((acc, style) => {
  acc[style.id] = style;
  return acc;
}, {});

export function isNoteStyleId(value) {
  return Boolean(value && STYLE_MAP[value]);
}

export function normalizeNoteStyleId(value) {
  return isNoteStyleId(value) ? value : DEFAULT_NOTE_STYLE_ID;
}

export function getNoteStyleClassName(styleId) {
  const target = STYLE_MAP[styleId] || STYLE_MAP[DEFAULT_NOTE_STYLE_ID];
  return target.className;
}
