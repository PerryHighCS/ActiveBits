import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useId,
} from 'react';
import { NOTE_STYLE_OPTIONS } from '../../shared/noteStyles.js';

export default function NoteStyleSelect({ value, onChange, label = 'Note style' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);
  const optionRefs = useRef([]);
  const labelId = useId();
  const listboxId = useId();

  const selectedIndex = useMemo(
    () => Math.max(0, NOTE_STYLE_OPTIONS.findIndex((option) => option.id === value)),
    [value],
  );
  const selected = NOTE_STYLE_OPTIONS[selectedIndex] || NOTE_STYLE_OPTIONS[0];

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleClick(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(selectedIndex);
    }
  }, [isOpen, selectedIndex]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => listboxRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const node = optionRefs.current[highlightedIndex];
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const closeList = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const selectOption = (optionId) => {
    onChange(optionId);
    closeList();
  };

  const moveHighlight = (delta) => {
    setHighlightedIndex((prev) => {
      const next = prev + delta;
      return Math.min(Math.max(next, 0), NOTE_STYLE_OPTIONS.length - 1);
    });
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      const option = NOTE_STYLE_OPTIONS[highlightedIndex];
      if (option) {
        selectOption(option.id);
      }
    }
  };

  const handleListboxKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = NOTE_STYLE_OPTIONS[highlightedIndex];
      if (option) {
        selectOption(option.id);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeList();
    } else if (event.key === 'Tab') {
      // Close but allow default tab navigation
      setIsOpen(false);
    }
  };

  return (
    <div className="relative flex flex-col gap-2" ref={containerRef}>
      <span id={labelId} className="text-sm font-semibold text-gray-700">{label}</span>
      <button
        type="button"
        ref={triggerRef}
        className="rounded border border-gray-300 px-2 py-1 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={labelId}
        aria-controls={isOpen ? listboxId : undefined}
        onKeyDown={handleTriggerKeyDown}
      >
        <div className={`h-8 w-full rounded border border-black/10 ${selected.className} flex items-center px-2`}>
          <span className="text-sm font-semibold text-gray-900">{selected.label}</span>
        </div>
      </button>
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          aria-activedescendant={NOTE_STYLE_OPTIONS[highlightedIndex]?.id ? `note-style-option-${NOTE_STYLE_OPTIONS[highlightedIndex].id}` : undefined}
          tabIndex={-1}
          ref={listboxRef}
          className="absolute z-10 mt-2 w-64 max-h-[16rem] overflow-auto rounded border border-gray-200 bg-white p-3 shadow-lg focus:outline-none"
          onKeyDown={handleListboxKeyDown}
        >
          <div className="grid grid-cols-2 gap-2">
            {NOTE_STYLE_OPTIONS.map((option, index) => {
              const isSelected = option.id === value;
              const isHighlighted = index === highlightedIndex;
              const optionId = `note-style-option-${option.id}`;
              return (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => selectOption(option.id)}
                  className={`relative h-20 rounded border transition ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : isHighlighted
                        ? 'border-gray-500 ring-1 ring-gray-300'
                        : 'border-gray-300'
                  } ${option.className}`}
                  role="option"
                  id={optionId}
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                >
                  <span className="absolute inset-x-2 top-2 rounded bg-black/50 px-2 py-1 text-xs font-semibold text-white text-center">
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
