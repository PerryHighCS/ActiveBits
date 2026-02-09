export function normalizeKeyPart(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

export function toKeyLabel(value: unknown, maxLength = 24): string {
  const normalized = normalizeKeyPart(value).trim();
  if (normalized === '') return '-';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}~`;
}

export function hashStringFNV1a(value: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}
