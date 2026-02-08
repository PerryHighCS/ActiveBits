import type { PythonListPracticeStudent } from '../../pythonListPracticeTypes.js'

export interface QuestionTypeOption {
  id: string
  label: string
}

export const QUESTION_TYPES: QuestionTypeOption[] = [
  { id: 'all', label: 'All Skills' },
  { id: 'index-get', label: 'Index (read)' },
  { id: 'index-set', label: 'Index (write)' },
  { id: 'len', label: 'len(list)' },
  { id: 'append', label: 'append()' },
  { id: 'remove', label: 'remove()' },
  { id: 'insert', label: 'insert()' },
  { id: 'pop', label: 'pop()' },
  { id: 'for-range', label: 'for range loop' },
  { id: 'range-len', label: 'range(len(list))' },
  { id: 'for-each', label: 'for each loop' },
]

export function downloadCsv(students: PythonListPracticeStudent[]): void {
  const headers = [
    'Student Name',
    'Total Attempts',
    'Correct',
    'Accuracy %',
    'Current Streak',
    'Longest Streak',
  ]
  const rows = students.map((s) => {
    const total = s.stats?.total || 0
    const correct = s.stats?.correct || 0
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0
    return [s.name || '', total, correct, accuracy, s.stats?.streak || 0, s.stats?.longestStreak || 0]
  })
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `python-list-practice-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export interface ManagerStats {
  totalStudents: number
  connected: number
}

export function computeManagerStats(students: PythonListPracticeStudent[]): ManagerStats {
  const totalStudents = Array.isArray(students) ? students.length : 0
  const connected = Array.isArray(students) ? students.filter((s) => s.connected).length : 0
  return { totalStudents, connected }
}

export type SortColumn = 'name' | 'total' | 'correct' | 'accuracy' | 'streak' | 'longestStreak'

export function sortStudents(
  students: PythonListPracticeStudent[],
  sortBy: SortColumn,
  sortDirection: 'asc' | 'desc',
): PythonListPracticeStudent[] {
  const sorted = [...(Array.isArray(students) ? students : [])]

  sorted.sort((a, b) => {
    let aVal: number | string = 0
    let bVal: number | string = 0

    switch (sortBy) {
      case 'name':
        aVal = (a.name || '').toLowerCase()
        bVal = (b.name || '').toLowerCase()
        break
      case 'total':
        aVal = a.stats?.total || 0
        bVal = b.stats?.total || 0
        break
      case 'correct':
        aVal = a.stats?.correct || 0
        bVal = b.stats?.correct || 0
        break
      case 'accuracy': {
        const aTotal = a.stats?.total || 0
        const bTotal = b.stats?.total || 0
        aVal = aTotal > 0 ? (a.stats?.correct || 0) / aTotal : 0
        bVal = bTotal > 0 ? (b.stats?.correct || 0) / bTotal : 0
        break
      }
      case 'streak':
        aVal = a.stats?.streak || 0
        bVal = b.stats?.streak || 0
        break
      case 'longestStreak':
        aVal = a.stats?.longestStreak || 0
        bVal = b.stats?.longestStreak || 0
        break
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  return sorted
}
