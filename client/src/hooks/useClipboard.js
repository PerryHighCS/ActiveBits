import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Custom hook for copying text to clipboard with state management
 * @param {number} resetDelay - Time in ms before resetting copied state (default: 2000)
 * @returns {object} - { copyToClipboard, copiedText, isCopied }
 */
export function useClipboard(resetDelay = 2000) {
  const [copiedText, setCopiedText] = useState(null);
  const timeoutRef = useRef(null);

  const copyToClipboard = useCallback(async (text) => {
    if (!text) return false;
    
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCopiedText(null);
        timeoutRef.current = null;
      }, resetDelay);
      return true;
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return false;
    }
  }, [resetDelay]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return {
    copyToClipboard,
    copiedText,
    isCopied: (text) => copiedText === text,
  };
}
