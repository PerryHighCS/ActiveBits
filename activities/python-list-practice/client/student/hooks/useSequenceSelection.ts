import { useCallback, useState } from 'react'

interface UseSequenceSelectionOptions {
  interactiveList?: unknown[]
  supportsSequenceSelection?: boolean
  isListBuildVariant?: boolean
  showNext?: boolean
  setAnswer?: (answer: string | ((prev: string) => string)) => void
  setInsertSelections?: (selections: string[] | ((prev?: string[]) => string[])) => void
  getValueForIndex?: (idx: number) => unknown
  challengeOp?: string | null
}

interface UseSequenceSelectionReturn {
  selectedIndex: number | null
  selectedValueIndex: number | null
  selectedRange: [number, number] | null
  selectedSequence: number[]
  handleIndexClick: (idx: number) => void
  handleValueClick: (idx: number, event?: unknown) => void
  applyRangeSelection: (startIdx: number, endIdx: number) => void
  handleSequenceSelectionClick: (idx: number, event?: unknown) => void
  clearSelection: () => void
}

export default function useSequenceSelection({
  interactiveList = [],
  supportsSequenceSelection = false,
  isListBuildVariant = false,
  showNext = false,
  setAnswer,
  setInsertSelections,
  getValueForIndex,
  challengeOp = null,
}: UseSequenceSelectionOptions = {}): UseSequenceSelectionReturn {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedValueIndex, setSelectedValueIndex] = useState<number | null>(null)
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null)
  const [selectedSequence, setSelectedSequence] = useState<number[]>([])

  const applyRangeSelection = useCallback(
    (startIdx: number, endIdx: number) => {
      if (!supportsSequenceSelection || !interactiveList.length) return
      const rangeStart = Math.max(0, Math.min(startIdx, endIdx))
      const rangeEnd = Math.min(interactiveList.length - 1, Math.max(startIdx, endIdx))
      setSelectedRange([rangeStart, rangeEnd])
      const indices: number[] = []
      const direction = startIdx <= endIdx ? 1 : -1
      for (let i = startIdx; direction > 0 ? i <= endIdx : i >= endIdx; i += direction) {
        if (i >= 0 && i < interactiveList.length) {
          indices.push(i)
        }
      }
      setSelectedSequence(indices)
      const slice = indices.map((idx) => interactiveList[idx])
      if (isListBuildVariant) {
        const formatted = slice.map((item) => (typeof item === 'string' ? `'${item}'` : String(item)))
        setInsertSelections?.(formatted)
      } else {
        setAnswer?.(slice.map((item) => String(item)).join(', '))
      }
    },
    [interactiveList, supportsSequenceSelection, isListBuildVariant, setAnswer, setInsertSelections],
  )

  const handleSequenceSelectionClick = useCallback(
    (idx: number, event?: unknown) => {
      if (!supportsSequenceSelection || showNext) return
      const eventObj = event as { shiftKey?: boolean } | null | undefined
      if (eventObj?.shiftKey && selectedSequence.length > 0) {
        const last = selectedSequence[selectedSequence.length - 1]
        if (last !== undefined) {
          applyRangeSelection(last, idx)
        }
        return
      }
      if (idx >= 0 && idx < interactiveList.length) {
        const values = interactiveList[idx]!
        if (isListBuildVariant) {
          const formatted = typeof values === 'string' ? `'${values}'` : String(values)
          setInsertSelections?.((prev) => [...(prev || []), formatted])
        } else {
          setAnswer?.((prev) => (prev ? `${prev}, ${String(values)}` : String(values)))
        }
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
  )

  const handleIndexClick = useCallback(
    (idx: number) => {
      if (showNext) return
      setSelectedIndex(idx)
      setSelectedValueIndex(null)
      setSelectedRange(null)
      setSelectedSequence([])
      if (typeof setAnswer === 'function') {
        const formatted = String(idx)
        setAnswer((prev) => (prev ? `${prev}, ${formatted}` : formatted))
      }
    },
    [showNext, setAnswer],
  )

  const handleValueClick = useCallback(
    (idx: number, event?: unknown) => {
      if (showNext) return
      const value = getValueForIndex ? getValueForIndex(idx) : interactiveList[idx]
      const resolvedValue = value !== undefined ? value : interactiveList[idx]!
      setSelectedValueIndex(idx)
      setSelectedIndex(null)
      setSelectedRange(null)
      setSelectedSequence([])
      if (isListBuildVariant) {
        const formatted = typeof resolvedValue === 'string' ? `'${resolvedValue}'` : String(resolvedValue)
        setInsertSelections?.((prev) => [...(prev || []), formatted])
        return
      }
      // Special-case: for-range questions append clicked values to the answer sequence
      if (challengeOp === 'for-range') {
        if (resolvedValue !== undefined) {
          setAnswer?.((prev) => (prev ? `${prev}, ${String(resolvedValue)}` : String(resolvedValue)))
        }
        return
      }
      if (supportsSequenceSelection) {
        handleSequenceSelectionClick(idx, event)
        return
      }
      if (resolvedValue !== undefined) {
        setAnswer?.(String(resolvedValue))
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
  )

  const clearSelection = useCallback(() => {
    setSelectedIndex(null)
    setSelectedValueIndex(null)
    setSelectedRange(null)
    setSelectedSequence([])
  }, [])

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
  }
}
