export type SortDirection = 'asc' | 'desc';
export type SortableFeedbackField = 'to' | 'fromNameSnapshot' | 'createdAt';

export type SortableFeedbackEntry = Record<string, unknown> & {
  id?: string;
  to?: string | null;
  fromNameSnapshot?: string;
  createdAt?: number;
};

export function sortFeedbackEntries<T extends SortableFeedbackEntry>(
  entries: T[] = [],
  field: SortableFeedbackField = 'createdAt',
  direction: SortDirection = 'desc',
): T[] {
  const dir: SortDirection = direction === 'asc' ? 'asc' : 'desc';
  const multiplier = dir === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    const valA = a?.[field];
    const valB = b?.[field];
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
