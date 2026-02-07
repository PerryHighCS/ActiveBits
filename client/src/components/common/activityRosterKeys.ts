export interface ActivityRosterKeyRow {
  id?: string | number
  name?: string
}

export function buildUniqueRosterRowKeys<TStudent extends ActivityRosterKeyRow = ActivityRosterKeyRow>(
  students: TStudent[],
): string[] {
  const seenBaseKeys = new Map<string, number>()

  return students.map((student, index) => {
    const hasStringId = typeof student.id === 'string' && student.id.length > 0
    const hasNumberId = typeof student.id === 'number'
    const hasName = typeof student.name === 'string' && student.name.length > 0
    const baseKey = hasStringId || hasNumberId
      ? `id:${String(student.id)}`
      : hasName
        ? `name:${student.name}`
        : `index:${index}`

    const seenCount = seenBaseKeys.get(baseKey) ?? 0
    seenBaseKeys.set(baseKey, seenCount + 1)

    return seenCount === 0 ? baseKey : `${baseKey}:${seenCount}`
  })
}
