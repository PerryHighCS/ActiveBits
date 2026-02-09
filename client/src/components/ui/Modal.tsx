import type { MouseEvent, ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children?: ReactNode
}

export default function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-3xl w-full mx-4 rounded shadow-lg max-h-[90vh] overflow-y-auto"
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between p-2 border-b">
          {(title !== null && title !== undefined && title !== '') && <h2 className="text-lg font-semibold">{title}</h2>}
          <button
            className="text-gray-500 hover:text-gray-700 text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
