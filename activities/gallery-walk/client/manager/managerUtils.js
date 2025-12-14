function coerceDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTimestampMeta(value, referenceDate = new Date()) {
  const date = coerceDate(value);
  if (!date) {
    return { date: null, showDateOnScreen: false };
  }
  const ref = coerceDate(referenceDate);
  const showDateOnScreen = !(ref
    && date.getFullYear() === ref.getFullYear()
    && date.getMonth() === ref.getMonth()
    && date.getDate() === ref.getDate());
  return { date, showDateOnScreen };
}
