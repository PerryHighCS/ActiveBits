import { useState, useCallback } from 'react';

/**
 * Custom hook for copying text to clipboard with state management
 * @param {number} resetDelay - Time in ms before resetting copied state (default: 2000)
 * @returns {object} - { copyToClipboard, copiedText, isCopied }
 */
export function useClipboard(resetDelay = 2000) {
  const [copiedText, setCopiedText] = useState(null);

  const copyToClipboard = useCallback(async (text) => {
    if (!text) return false;
    
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), resetDelay);
      return true;
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return false;
    }
  }, [resetDelay]);

  return {
    copyToClipboard,
    copiedText,
    isCopied: (text) => copiedText === text,
  };
}
