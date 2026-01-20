/**
 * Utility functions for rendering pseudocode with markdown formatting
 */

/**
 * Parse pseudocode text and render bold text marked with **text** syntax
 * @param {string} text - The pseudocode line text
 * @returns {Array} Array of strings and React elements for rendering
 * 
 * @example
 * renderBoldText('**function** mergeSort(arr)') 
 * // Returns: ['function', ' mergeSort(arr)']
 * // Where 'function' is wrapped in <strong> tags
 */
export function renderBoldText(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return {
        type: 'bold',
        content: part.slice(2, -2)
      };
    }
    return {
      type: 'text',
      content: part
    };
  }).filter(part => part.content); // Remove empty parts
}

/**
 * Render pseudocode text with bold formatting as React elements
 * @param {string} text - The pseudocode line text
 * @returns {React.ReactElement} React fragment with rendered content
 */
export function renderPseudocodeWithBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
