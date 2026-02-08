import React, { type MouseEvent } from 'react'
import type {
  JavaFormatReferenceData,
  ReferenceListSection,
  ReferenceSection,
  ReferenceTableSection,
} from '../../javaFormatPracticeTypes.js'

interface FormatReferenceModalProps {
  isOpen: boolean
  onClose: () => void
  referenceData?: JavaFormatReferenceData | null
}

function getRowCells(section: ReferenceTableSection, row: string[] | Record<string, string>): string[] {
  if (Array.isArray(row)) {
    return row
  }

  return section.columns.map((column) => {
    const key = column.toLowerCase().replace(/\s+/g, '')
    return row[key] || ''
  })
}

function renderTable(section: ReferenceTableSection) {
  return (
    <div key={section.id} className="reference-section">
      <h3>{section.title}</h3>
      <table className="reference-table">
        <thead>
          <tr>
            {section.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, rowIndex) => {
            const cells = getRowCells(section, row)
            return (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cellIndex === 0 ? 'code-cell' : ''}>
                    {cell}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function renderList(section: ReferenceListSection) {
  return (
    <div key={section.id} className="reference-section">
      <h3>{section.title}</h3>
      <ul className="reference-list">
        {section.items.map((item, index) => (
          <li key={index}>
            {item.bold ? (
              <React.Fragment>
                <strong>{item.bold}</strong> {item.text}
              </React.Fragment>
            ) : item.code ? (
              <React.Fragment>
                <code>{item.code}</code> {item.text}
              </React.Fragment>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function renderSection(section: ReferenceSection) {
  if (section.type === 'table') {
    return renderTable(section)
  }
  return renderList(section)
}

export default function FormatReferenceModal({ isOpen, onClose, referenceData }: FormatReferenceModalProps) {
  if (!isOpen) return null

  const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={handleContentClick}>
        <div className="modal-header">
          <h2>{referenceData?.title || 'Reference'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">{referenceData?.sections?.map((section) => renderSection(section))}</div>
      </div>
    </div>
  )
}
