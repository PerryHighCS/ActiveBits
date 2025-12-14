import React from 'react';
import { getTimestampMeta } from '../manager/managerUtils.js';

export default function GalleryWalkFeedbackTable({
  feedback = [],
  reviewees = {},
  reviewers = {},
  emptyMessage = 'No feedback entries in this file.',
  containerClassName = '',
  headerOverrides = {},
}) {
  const headers = {
    to: headerOverrides.to ?? 'To',
    from: headerOverrides.from ?? 'From',
    posted: headerOverrides.posted ?? 'Posted',
    message: headerOverrides.message ?? 'Message',
  };
  const wrapperClassName = [
    'overflow-x-auto rounded-lg border border-gray-200 bg-white shadow print:border-0 print:shadow-none',
    containerClassName,
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName}>
      <table className="min-w-full divide-y divide-gray-200 text-sm print:text-xs">
        <thead className="bg-gray-50 print:bg-white">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">
              {headers.to}
            </th>
            <th className="px-4 py-3 text-left font-semibold">
              {headers.from}
            </th>
            <th className="px-4 py-3 text-left font-semibold">
              {headers.posted}
            </th>
            <th className="px-4 py-3 text-left font-semibold">
              {headers.message}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {feedback.map((entry) => {
            const timestamp = getTimestampMeta(entry.createdAt);
            const screenText = timestamp.date
              ? (timestamp.showDateOnScreen
                ? `${timestamp.date.toLocaleDateString()} ${timestamp.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : timestamp.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
              : '—';
            const printText = timestamp.date
              ? `${timestamp.date.toLocaleDateString()} ${timestamp.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : '—';
            return (
              <tr key={entry.id}>
                <td className="px-4 py-3">
                  {reviewees[entry.to]?.name
                    || reviewees[entry.to]?.projectTitle
                    || entry.to
                    || '—'}
                </td>
                <td className="px-4 py-3">
                  {entry.fromNameSnapshot || reviewers[entry.from]?.name || '—'}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <span className="print:hidden">{screenText}</span>
                  <span className="hidden print:inline">{printText}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="whitespace-pre-wrap">{entry.message}</p>
                </td>
              </tr>
            );
          })}
          {!feedback.length && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
