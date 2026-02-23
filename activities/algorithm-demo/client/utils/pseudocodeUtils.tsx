import type { ReactElement } from 'react'

/**
 * Utility functions for rendering pseudocode with markdown formatting
 */

export interface PseudocodeToken {
  type: 'bold' | 'text'
  content: string
}

export function renderBoldText(text: string): PseudocodeToken[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map<PseudocodeToken>((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return {
        type: 'bold',
        content: part.slice(2, -2),
      }
    }
    return {
      type: 'text',
      content: part,
    }
  }).filter((part) => part.content.length > 0)
}

export function renderPseudocodeWithBold(text: string): Array<string | ReactElement> {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}
