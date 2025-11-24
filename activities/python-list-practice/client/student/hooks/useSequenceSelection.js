import { useCallback, useState } from 'react';

export default function useSequenceSelection({
  interactiveList = [],
  supportsSequenceSelection = false,
  isListBuildVariant = false,
  showNext = false,
  setAnswer,
  setInsertSelections,
  getValueForIndex,
  challengeOp = null,
} = {}) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selectedValueIndex, setSelectedValueIndex] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectedSequence, setSelectedSequence] = useState([]);

  const applyRangeSelection = useCallback(
    (startIdx, endIdx) => {
      if (!supportsSequenceSelection || !interactiveList.length) return;
      const rangeStart = Math.max(0, Math.min(startIdx, endIdx));
      const rangeEnd = Math.min(interactiveList.length - 1, Math.max(startIdx, endIdx));
      setSelectedRange([rangeStart, rangeEnd]);
      const indices = [];
      const direction = startIdx <= endIdx ? 1 : -1;
      for (let i = startIdx; direction > 0 ? i <= endIdx : i >= endIdx; i += direction) {
        if (i >= 0 && i < interactiveList.length) {
          indices.push(i);
        }
      }
      setSelectedSequence(indices);
      const slice = indices.map((idx) => interactiveList[idx]);
      if (isListBuildVariant) {
        const formatted = slice.map((item) => (typeof item === 'string' ? `'${item}'` : String(item)));
        setInsertSelections && setInsertSelections(formatted);
      } else {
        setAnswer && setAnswer(slice.map((item) => String(item)).join(', '));
      }
    },
    [interactiveList, supportsSequenceSelection, isListBuildVariant, setAnswer, setInsertSelections],
  );

  const handleSequenceSelectionClick = useCallback(
    (idx, event = null) => {
      if (!supportsSequenceSelection || showNext) return;
      if (event && event.shiftKey && selectedSequence.length > 0) {
        const last = selectedSequence[selectedSequence.length - 1];
        applyRangeSelection(last, idx);
        return;
      }
      const values = interactiveList[idx];
      if (isListBuildVariant) {
        const formatted = typeof values === 'string' ? `'${values}'` : String(values);
        setInsertSelections && setInsertSelections((prev) => [...(prev || []), formatted]);
      } else {
        setAnswer && setAnswer((prev) => (prev ? `${prev}, ${String(values)}` : String(values)));
      }
    },
    [
      applyRangeSelection,
      interactiveList,
      isListBuildVariant,
      selectedSequence,
      showNext,
      setAnswer,
      setInsertSelections,
      supportsSequenceSelection,
    ],
  );

  const handleIndexClick = useCallback(
    (idx) => {
      if (showNext) return;
      setSelectedIndex(idx);
      setSelectedValueIndex(null);
      setSelectedRange(null);
      setSelectedSequence([]);
      if (typeof setAnswer === 'function') {
        const formatted = String(idx);
        setAnswer((prev) => (prev ? `${prev}, ${formatted}` : formatted));
      }
    },
    [showNext, setAnswer],
  );

  const handleValueClick = useCallback(
    (idx, event) => {
      if (showNext) return;
      const value = getValueForIndex ? getValueForIndex(idx) : interactiveList[idx];
      const resolvedValue = value !== undefined ? value : interactiveList[idx];
      setSelectedValueIndex(idx);
      setSelectedIndex(null);
      setSelectedRange(null);
      setSelectedSequence([]);
      if (isListBuildVariant) {
        const formatted = typeof resolvedValue === 'string' ? `'${resolvedValue}'` : String(resolvedValue);
        setInsertSelections && setInsertSelections((prev) => [...(prev || []), formatted]);
        return;
      }
      // Special-case: for-range questions append clicked values to the answer sequence
      if (challengeOp === 'for-range') {
        if (resolvedValue !== undefined) {
          setAnswer && setAnswer((prev) => (prev ? `${prev}, ${String(resolvedValue)}` : String(resolvedValue)));
        }
        return;
      }
      if (supportsSequenceSelection) {
        handleSequenceSelectionClick(idx, event);
        return;
      }
      if (resolvedValue !== undefined) {
        setAnswer && setAnswer(String(resolvedValue));
      }
    },
    [
      showNext,
      getValueForIndex,
      interactiveList,
      isListBuildVariant,
      handleSequenceSelectionClick,
      setInsertSelections,
      supportsSequenceSelection,
      setAnswer,
      challengeOp,
    ],
  );

  const clearSelection = useCallback(() => {
    setSelectedIndex(null);
    setSelectedValueIndex(null);
    setSelectedRange(null);
    setSelectedSequence([]);
  }, []);

  return {
    selectedIndex,
    selectedValueIndex,
    selectedRange,
    selectedSequence,
    handleIndexClick,
    handleValueClick,
    applyRangeSelection,
    handleSequenceSelectionClick,
    clearSelection,
  };
}
