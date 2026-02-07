import type { ReactNode } from 'react'
import { buildUniqueRosterRowKeys } from './activityRosterKeys'

type AccentMode = 'neutral' | 'emerald'
type SortDirection = 'asc' | 'desc'
type AriaSort = 'ascending' | 'descending' | 'none'

export interface ActivityRosterRow {
  id?: string | number
  name?: string
  [key: string]: unknown
}

export interface ActivityRosterColumn<TStudent extends ActivityRosterRow = ActivityRosterRow> {
  id: string
  label: string
  align?: 'left' | 'center'
  render?: (student: TStudent) => ReactNode
}

export interface ActivityRosterProps<TStudent extends ActivityRosterRow = ActivityRosterRow> {
  students?: TStudent[]
  columns?: Array<ActivityRosterColumn<TStudent>>
  sortBy?: string
  sortDirection?: SortDirection
  onSort?: (columnId: string) => void
  loading?: boolean
  error?: string | null
  emptyMessage?: string
  accent?: AccentMode
}

function SortIcon({
  column,
  sortBy,
  sortDirection,
}: {
  column: string
  sortBy?: string
  sortDirection: SortDirection
}) {
  if (sortBy !== column) return <span className="text-gray-400 ml-1">⇅</span>
  return sortDirection === 'asc' ? <span className="ml-1">↓</span> : <span className="ml-1">↑</span>
}

function getAriaSortValue(
  columnId: string,
  sortBy: string | undefined,
  sortDirection: SortDirection,
): AriaSort {
  if (sortBy !== columnId) {
    return 'none'
  }

  return sortDirection === 'asc' ? 'ascending' : 'descending'
}

/**
 * Generic roster table for activity managers.
 * Renders a table of students with optional sorting and status.
 */
export default function ActivityRoster<TStudent extends ActivityRosterRow = ActivityRosterRow>({
  students = [],
  columns = [],
  sortBy,
  sortDirection = 'asc',
  onSort,
  loading = false,
  error = null,
  emptyMessage = 'No students yet.',
  accent = 'neutral',
}: ActivityRosterProps<TStudent>) {
  const isEmerald = accent === 'emerald'
  const containerBorder = isEmerald ? 'border-emerald-200' : 'border-gray-200'
  const headerClass = isEmerald ? 'bg-emerald-50 text-emerald-900 border-emerald-100' : 'bg-gray-50 text-gray-900 border-gray-200'
  const borderClass = isEmerald ? 'border-emerald-100' : 'border-gray-200'
  const rowKeys = buildUniqueRosterRowKeys(students)

  return (
    <div className={`bg-white/95 border ${containerBorder} shadow-lg rounded-xl overflow-x-auto`}>
      <table className="w-full text-left">
        <thead className={`${headerClass} border-b`}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={`px-4 py-2 ${column.align === 'center' ? 'text-center' : ''}`}
                aria-sort={onSort ? getAriaSortValue(column.id, sortBy, sortDirection) : undefined}
              >
                {onSort ? (
                  <button
                    type="button"
                    className={`inline-flex w-full items-center gap-1 ${column.align === 'center' ? 'justify-center' : 'justify-start'} cursor-pointer`}
                    onClick={() => onSort(column.id)}
                  >
                    <span>{column.label}</span>
                    <SortIcon column={column.id} sortBy={sortBy} sortDirection={sortDirection} />
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {error && (
            <tr>
              <td className="px-4 py-3 text-center text-red-600" colSpan={columns.length}>
                {error}
              </td>
            </tr>
          )}
          {loading && !error && (
            <tr>
              <td className="px-4 py-3 text-center text-gray-600" colSpan={columns.length}>
                Loading…
              </td>
            </tr>
          )}
          {!loading && !error && students.length === 0 && (
            <tr>
              <td className="px-4 py-3 text-center text-gray-600" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {students.map((student, index) => (
            <tr key={rowKeys[index] ?? `index:${index}`} className={`${borderClass} border-b`}>
              {columns.map((column) => {
                const renderedCell =
                  typeof column.render === 'function'
                    ? column.render(student)
                    : (student[column.id] as ReactNode)

                return (
                  <td key={column.id} className={`px-4 py-3 ${column.align === 'center' ? 'text-center' : ''}`}>
                    {renderedCell}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
