import React, { useState } from "react";

export function RosterPill({ hostname, onRemove, onRename, onClick }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(hostname);

  return (
    <div onClick={onClick} className="flex items-center gap-1 border rounded-full px-2 py-1 bg-white shadow-sm">
      {!editing ? (
        <>
          <button
            className="text-xs  hover:opacity-100"
            onClick={() => { setValue(hostname); setEditing(true); }}
            aria-label={`Edit ${hostname}`}
          >
            ✏️
          </button>
          <span className="font-mono text-sm">{hostname}</span>
          <button
            className="text-xs rounded-full hover:bg-red-50 text-red-600"
            onClick={() => {
                const confirmed = window.confirm(`Remove "${hostname}" from session?`);
                if (confirmed) onRemove();
            }}
            aria-label={`Remove ${hostname}`}
            title="Remove"
          >
            ❌
          </button>
        </>
      ) : (
        <>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onRename(value); setEditing(false); }
              if (e.key === "Escape") { setEditing(false); setValue(hostname); }
            }}
            className="border rounded px-1 text-sm font-mono w-[16ch]"
            autoFocus
          />
          <button
            className="text-xs underline decoration-dotted opacity-70 hover:opacity-100"
            onClick={() => { onRename(value); setEditing(false); }}
          >
            save
          </button>
          <button
            className="text-xs underline decoration-dotted opacity-70 hover:opacity-100"
            onClick={() => { setEditing(false); setValue(hostname); }}
          >
            cancel
          </button>
        </>
      )}
    </div>
  );
}

export default RosterPill;