import React from 'react';

export default function FormatReferenceModal({ isOpen, onClose, referenceData }) {
  if (!isOpen) return null;

  const renderSection = (section) => {
    if (section.type === 'table') {
      return renderTable(section);
    } else if (section.type === 'list') {
      return renderList(section);
    }
    return null;
  };

  const renderTable = (section) => {
    // Handle object-based row format by mapping columns to object keys
    const getRowCells = (row) => {
      if (Array.isArray(row)) {
        return row;
      }
      // If object, extract values in column order
      // Columns: ['Specifier', 'Type', 'Description', 'Example']
      // Maps to: specifier, type, description, example
      return section.columns.map(col => {
        const key = col.toLowerCase().replace(/\s+/g, '');
        return row[key] || '';
      });
    };

    return (
      <div key={section.id} className="reference-section">
        <h3>{section.title}</h3>
        <table className="reference-table">
          <thead>
            <tr>
              {section.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, idx) => {
              const cells = getRowCells(row);
              return (
                <tr key={idx}>
                  {cells.map((cell, cellIdx) => (
                    <td key={cellIdx} className={cellIdx === 0 ? 'code-cell' : ''}>
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderList = (section) => {
    return (
      <div key={section.id} className="reference-section">
        <h3>{section.title}</h3>
        <ul className="reference-list">
          {section.items.map((item, idx) => (
            <li key={idx}>
              {item.bold ? (
                <>
                  <strong>{item.bold}</strong> {item.text}
                </>
              ) : item.code ? (
                <>
                  <code>{item.code}</code> {item.text}
                </>
              ) : (
                item.text
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{referenceData?.title || 'Reference'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {referenceData?.sections?.map((section) => renderSection(section))}
        </div>
      </div>
    </div>
  );
}

