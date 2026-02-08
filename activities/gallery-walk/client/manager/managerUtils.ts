export interface TimestampMeta {
  date: Date | null;
  showDateOnScreen: boolean;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTimestampMeta(value: unknown, referenceDate: unknown = new Date()): TimestampMeta {
  const date = coerceDate(value);
  if (!date) {
    return { date: null, showDateOnScreen: false };
  }

  const ref = coerceDate(referenceDate);
  const showDateOnScreen = !(
    ref
    && date.getFullYear() === ref.getFullYear()
    && date.getMonth() === ref.getMonth()
    && date.getDate() === ref.getDate()
  );
  return { date, showDateOnScreen };
}
