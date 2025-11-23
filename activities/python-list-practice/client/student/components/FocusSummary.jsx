import React from 'react';

export default function FocusSummary({ allowedTypeList, allowedTypes, labels }) {
  return (
    <div className="mb-3">
      <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-2">Current focus</p>
      <div className="flex flex-wrap gap-2">
        {allowedTypeList.map((type) => (
          <span key={type} className={`python-list-chip ${allowedTypes.has(type) ? 'selected' : ''}`}>
            {labels[type] || type}
          </span>
        ))}
      </div>
    </div>
  );
}
