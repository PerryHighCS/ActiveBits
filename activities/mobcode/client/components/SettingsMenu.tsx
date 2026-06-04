import { useId, useState } from 'react'
import type { MobCodeThemeId } from '../../shared/types'
import { MOB_CODE_THEMES } from '../utils/constants'

interface SettingsMenuProps {
  theme: MobCodeThemeId
  onThemeChange: (theme: MobCodeThemeId) => void
  label?: string
}

export default function SettingsMenu({
  theme,
  onThemeChange,
  label = 'Theme',
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()

  return (
    <div className="relative">
      <button
        type="button"
        className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        aria-label={`${label} settings`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-10 mt-2 w-48 rounded border border-gray-200 bg-white p-2 shadow-lg"
        >
          <p className="px-2 pb-1 text-xs font-semibold uppercase text-gray-500">Editor Theme</p>
          {MOB_CODE_THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.id}
              className={[
                'block w-full rounded px-2 py-1.5 text-left text-sm',
                theme === option.id ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50',
              ].join(' ')}
              onClick={() => {
                onThemeChange(option.id)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
