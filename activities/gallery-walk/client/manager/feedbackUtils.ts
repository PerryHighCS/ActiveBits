export type SortDirection = 'asc' | 'desc';
export type SortableFeedbackField = 'to' | 'fromNameSnapshot' | 'createdAt';

export type SortableFeedbackEntry = {
  id?: string;
  to?: string | null;
  fromNameSnapshot?: string | null;
  createdAt?: number | null;
  [key: string]: unknown;
};

function getFieldValue(entry: SortableFeedbackEntry, field: SortableFeedbackField): string | number | null | undefined {
  switch (field) {
    case 'to':
      return entry.to;
    case 'fromNameSnapshot':
      return entry.fromNameSnapshot;
    case 'createdAt':
      return entry.createdAt;
    default:
      return undefined;
  }
}

export function sortFeedbackEntries<T extends SortableFeedbackEntry>(
  entries: T[] = [],
  field: SortableFeedbackField = 'createdAt',
  direction: SortDirection = 'desc',
): T[] {
  const dir: SortDirection = direction === 'asc' ? 'asc' : 'desc';
  const multiplier = dir === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    const valA = getFieldValue(a, field);
    const valB = getFieldValue(b, field);

    if (valA == null && valB == null) return 0;
    if (valA == null) return -1 * multiplier;
    if (valB == null) return 1 * multiplier;

    if (field === 'createdAt') {
      if (valA < valB) return -1 * multiplier;
      if (valA > valB) return 1 * multiplier;
      return 0;
    }

    const compareResult = String(valA).localeCompare(String(valB));
    if (compareResult < 0) return -1 * multiplier;
    if (compareResult > 0) return 1 * multiplier;
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
