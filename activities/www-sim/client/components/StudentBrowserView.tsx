import { Fragment, useEffect, useState } from 'react'
import type { StudentTemplate, TemplateFragment } from '../../wwwSimTypes.js'

interface FragmentTagProps {
  src: string
  hash: string
  onSubmit?: (hash: string, content: string) => void
  initialContent?: string
}

interface StudentBrowserViewProps {
  template: StudentTemplate | null
  sessionId?: string
}

function FragmentTag({ src, hash, onSubmit, initialContent }: FragmentTagProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isValid, setIsValid] = useState<boolean | null>(null)
  const [wasSubmitted, setWasSubmitted] = useState(false)

  useEffect(() => {
    if (initialContent && !wasSubmitted) {
      setInputValue(initialContent)
      setIsValid(true)
      setWasSubmitted(true)
    }
  }, [initialContent, wasSubmitted])

  async function createHash(fragment: string): Promise<string> {
    const buffer = new TextEncoder().encode(fragment)
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  const handleValidate = async (): Promise<void> => {
    const computedHash = await createHash(inputValue.trim())
    const valid = computedHash === hash
    setIsValid(valid)
    if (valid && onSubmit) {
      onSubmit(hash, inputValue.trim())
      setWasSubmitted(true)
      setIsOpen(false)
    }
  }

  if (wasSubmitted) {
    return (
      <span className="text-green-600 font-mono">
        &lt;fragment src=&quot;{src}&quot;&gt;{inputValue}&lt;/fragment&gt;
      </span>
    )
  }

  return (
    <div
      className="group relative"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => !inputValue && setIsOpen(false)}
    >
      {!isOpen ? (
        <span className="text-blue-600 font-mono cursor-pointer" onClick={() => setIsOpen(true)}>
          &lt;fragment src=&quot;{src}&quot;&gt;&lt;/fragment&gt;
        </span>
      ) : (
        <div
          className={`flex flex-col gap-1 p-2 rounded border ${isValid === true ? 'border-green-400 bg-green-50' : isValid === false ? 'border-red-400 bg-red-50' : 'border-blue-300 bg-white'}`}
        >
          <span className="text-xs font-semibold text-blue-600">
            Paste fragment for <code>{src}</code>:
          </span>
          <textarea
            className="text-xs font-mono border rounded p-1"
            rows={3}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleValidate()
              }
            }}
          />
          <button
            onClick={() => void handleValidate()}
            className="bg-blue-500 text-white text-xs px-2 py-1 rounded hover:bg-blue-600"
          >
            Check
          </button>
          {isValid === true && <div className="text-green-600 text-xs">✓ Fragment verified!</div>}
          {isValid === false && <div className="text-red-600 text-xs">✗ Fragment does not match hash</div>}
        </div>
      )}
    </div>
  )
}

function getTemplateFragments(template: StudentTemplate | null): TemplateFragment[] {
  if (!template || !Array.isArray(template.fragments)) return []
  return template.fragments
}

export default function StudentBrowserView({ template, sessionId }: StudentBrowserViewProps) {
  const [renderedFragments, setRenderedFragments] = useState<Record<string, string>>({})
  const title = template?.title ?? ''
  const fragments = getTemplateFragments(template)

  useEffect(() => {
    if (!sessionId) {
      setRenderedFragments({})
      return
    }

    const stored = localStorage.getItem(`${sessionId}-fragments`)
    if (!stored) {
      setRenderedFragments({})
      return
    }

    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>
      const normalized = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>
      setRenderedFragments(normalized)
    } catch {
      localStorage.removeItem(`${sessionId}-fragments`)
      setRenderedFragments({})
    }
  }, [sessionId])

  const handleFragmentSubmit = (hash: string, content: string): void => {
    if (!sessionId) return
    setRenderedFragments((prev) => {
      const updated = { ...prev, [hash]: content }
      localStorage.setItem(`${sessionId}-fragments`, JSON.stringify(updated))
      return updated
    })
  }

  if (!fragments.length) {
    return null
  }

  return (
    <div className="p-4">
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="w-full lg:w-1/2 border border-gray-300 rounded">
          <div className="bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 border-b border-gray-300 rounded-t">
            Source HTML
          </div>
          <pre className="text-sm whitespace-pre-wrap font-mono p-2 bg-gray-50 rounded-b">
            {`<html>
  <head>
    <title>${title}</title>
  </head>
  <body>
`}
            {fragments.map((fragment) => (
              <Fragment key={fragment.hash}>
                {'    '}
                <FragmentTag
                  src={fragment.url}
                  hash={fragment.hash}
                  onSubmit={handleFragmentSubmit}
                  initialContent={renderedFragments[fragment.hash]}
                />
                {'\n'}
              </Fragment>
            ))}
            {'  </body>\n</html>'}
          </pre>
        </div>

        <div className="w-full lg:w-1/2 border border-gray-300 rounded">
          <div className="bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 border-b border-gray-300 rounded-t">
            Rendered View
          </div>
          <div className="text-sm text-gray-800 bg-white rounded-b p-2">
            <h3 className="text-lg font-bold mb-2">{title}</h3>
            {fragments.map((fragment) => (
              <Fragment key={`render-${fragment.hash}`}>
                {renderedFragments[fragment.hash] ? (
                  <span className="text-sm text-gray-800 whitespace-pre-wrap">
                    {renderedFragments[fragment.hash]}{' '}
                  </span>
                ) : (
                  <div className="italic text-gray-400">Waiting for content from {fragment.url}</div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
