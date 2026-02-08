export type SortDirection = 'asc' | 'desc';

export type SortableFeedbackEntry = Record<string, unknown> & {
  id?: string;
};

export function sortFeedbackEntries<T extends SortableFeedbackEntry>(
  entries: T[] = [],
  field: string = 'createdAt',
  direction: SortDirection = 'desc',
): T[] {
  const safeField = field || 'createdAt';
  const dir: SortDirection = direction === 'asc' ? 'asc' : 'desc';
  const multiplier = dir === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    const valA = a?.[safeField];
    const valB = b?.[safeField];
    if (valA == null && valB == null) return 0;
    if (valA == null) return -1 * multiplier;
    if (valB == null) return 1 * multiplier;
    if (valA < valB) return -1 * multiplier;
    if (valA > valB) return 1 * multiplier;
    return 0;
  });
}

export function insertFeedbackEntry<T extends SortableFeedbackEntry>(
  entries: T[] = [],
  nextEntry?: T | null,
): T[] {
  if (!nextEntry || typeof nextEntry !== 'object') return entries;
  const filtered = entries.filter((entry) => entry?.id !== nextEntry.id);
  return [nextEntry, ...filtered];
}
