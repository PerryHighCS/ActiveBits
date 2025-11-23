import React from 'react';

/**
 * Generic roster table for activity managers.
 * Renders a table of students with optional sorting and status.
 */
export default function ActivityRoster({
  students = [],
  columns = [],
  sortBy,
  sortDirection = 'asc',
  onSort,
  loading = false,
  error = null,
  emptyMessage = 'No students yet.',
  accent = 'neutral', // 'neutral' | 'emerald'
}) {
  const isEmerald = accent === 'emerald';
  const containerBorder = isEmerald ? 'border-emerald-200' : 'border-gray-200';
  const headerClass = isEmerald ? 'bg-emerald-50 text-emerald-900 border-emerald-100' : 'bg-gray-50 text-gray-900 border-gray-200';
  const borderClass = isEmerald ? 'border-emerald-100' : 'border-gray-200';

  const SortIcon = ({ column }) => {
    if (!onSort) return null;
    if (sortBy !== column) return <span className="text-gray-400 ml-1">⇅</span>;
    return sortDirection === 'asc' ? <span className="ml-1">↓</span> : <span className="ml-1">↑</span>;
  };

  return (
    <div className={"bg-white/95 border " + containerBorder + " shadow-lg rounded-xl overflow-x-auto"}>
      <table className="w-full text-left">
        <thead className={`${headerClass} border-b`}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                className={`px-4 py-2 ${col.align === 'center' ? 'text-center' : ''} cursor-${onSort ? 'pointer' : 'default'}`}
                onClick={onSort ? () => onSort(col.id) : undefined}
              >
                {col.label}
                {onSort && <SortIcon column={col.id} />}
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
          {students.map((s) => (
            <tr key={s.id || s.name} className={`${borderClass} border-b`}>
              {columns.map((col) => (
                <td key={col.id} className={`px-4 py-3 ${col.align === 'center' ? 'text-center' : ''}`}>
                  {typeof col.render === 'function' ? col.render(s) : s[col.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
