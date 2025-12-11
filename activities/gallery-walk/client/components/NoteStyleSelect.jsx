import React, { useState, useRef, useEffect } from 'react';
import { NOTE_STYLE_OPTIONS } from '../../shared/noteStyles.js';

export default function NoteStyleSelect({ value, onChange, label = 'Note style' }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const selected = NOTE_STYLE_OPTIONS.find((option) => option.id === value) || NOTE_STYLE_OPTIONS[0];

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

  return (
    <div className="relative flex flex-col gap-2" ref={containerRef}>
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      <button
        type="button"
        className="rounded border border-gray-300 px-2 py-1 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div className={`h-8 w-full rounded border border-black/10 ${selected.className} flex items-center px-2`}>
          <span className="text-sm font-semibold text-gray-900">{selected.label}</span>
        </div>
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-2 w-64 max-h-[16rem] overflow-auto rounded border border-gray-200 bg-white p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            {NOTE_STYLE_OPTIONS.map((option) => {
              const isSelected = option.id === value;
              return (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                  }}
                  className={`relative h-20 rounded border transition ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'
                  } ${option.className}`}
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
