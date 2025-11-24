// Small UI utilities for Python List Practice student component
export function normalizeListAnswer(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const noBrackets = trimmed.replace(/^\[|\]$/g, '');
  return noBrackets.split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'))
    .join(',');
}

export function normalizeExpected(challenge) {
  if (!challenge) return '';
  if (challenge.type === 'list') return normalizeListAnswer(challenge.expected);
  return (challenge.expected || '').trim();
}

export default {
  normalizeListAnswer,
  normalizeExpected,
};
