import ReactMarkdown from 'react-markdown'
import type { AllowElement, Components, UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownVariant = 'block' | 'inline'

interface Props {
  markdown: string
  className?: string
  variant?: MarkdownVariant
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:'])
const DATA_IMAGE_PREFIX = /^data:image\/(?!svg\+xml)[a-z0-9.+-]+;base64,/i

function isRelativeUrl(value: string): boolean {
  return /^(#|\/(?!\/)|\.{1,2}\/)/.test(value)
}

export function isAllowedMarkdownUrl(value: string, kind: 'link' | 'image'): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false

  if (kind === 'image' && DATA_IMAGE_PREFIX.test(trimmed)) {
    return true
  }

  if (isRelativeUrl(trimmed)) {
    return kind === 'link'
  }

  try {
    const parsed = new URL(trimmed)
    return kind === 'image'
      ? SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)
      : SAFE_LINK_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}

const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (key === 'src' && node.tagName === 'img') {
    return isAllowedMarkdownUrl(url, 'image') ? url : ''
  }
  if (key === 'href' && node.tagName === 'a') {
    return isAllowedMarkdownUrl(url, 'link') ? url : ''
  }
  return url
}

const markdownAllowElement: AllowElement = (node) => {
  if (node.tagName === 'input') {
    return false
  }
  if (node.tagName === 'img') {
    const src = node.properties.src
    return typeof src === 'string' && isAllowedMarkdownUrl(src, 'image')
  }
  return true
}

const baseText = 'text-slate-800 dark:text-slate-200'
const compactText = 'text-inherit'

function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}

function createMarkdownComponents(variant: MarkdownVariant): Components {
  return {
    a({ children, href, node: _node, ...props }) {
      const safeHref = typeof href === 'string' && isAllowedMarkdownUrl(href, 'link')
        ? href
        : undefined

      if (safeHref === undefined) {
        return (
          <span {...props}>
            {children}
          </span>
        )
      }

      return (
        <a
          {...props}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900 dark:text-indigo-300 dark:decoration-indigo-700 dark:hover:text-indigo-100"
        >
          {children}
        </a>
      )
    },
    blockquote({ children, node: _node, ...props }) {
      return (
        <blockquote
          {...props}
          className="border-l-4 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-300"
        >
          {children}
        </blockquote>
      )
    },
    code({ children, className, node: _node, ...props }) {
      const isBlockCode = className?.includes('language-') || String(children).includes('\n')
      if (isBlockCode) {
        return (
          <code
            {...props}
            className={cx('font-mono text-inherit', className)}
          >
            {children}
          </code>
        )
      }

      return (
        <code
          {...props}
          className={cx(
            'rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.92em] text-slate-900 dark:bg-slate-800 dark:text-slate-100',
            className,
          )}
        >
          {children}
        </code>
      )
    },
    img({ alt, node: _node, ...props }) {
      return (
        <img
          {...props}
          alt={alt ?? ''}
          loading="lazy"
          className="my-2 max-h-96 max-w-full rounded border border-slate-200 object-contain dark:border-slate-700"
        />
      )
    },
    ol({ children, node: _node, ...props }) {
      return (
        <ol {...props} className="list-decimal space-y-1 pl-5">
          {children}
        </ol>
      )
    },
    p({ children, node: _node, ...props }) {
      if (variant === 'inline') {
        return (
          <span {...props} className="leading-relaxed">
            {children}
          </span>
        )
      }

      return (
        <p {...props} className="leading-relaxed">
          {children}
        </p>
      )
    },
    pre({ children, node: _node, ...props }) {
      return (
        <pre
          {...props}
          className="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3 text-sm leading-relaxed text-slate-100 shadow-sm dark:border-slate-700"
        >
          {children}
        </pre>
      )
    },
    table({ children, node: _node, ...props }) {
      return (
        <div className="max-w-full overflow-x-auto">
          <table {...props} className="w-full min-w-max border-collapse text-sm">
            {children}
          </table>
        </div>
      )
    },
    td({ children, node: _node, ...props }) {
      return (
        <td {...props} className="border border-slate-200 px-2 py-1.5 align-top dark:border-slate-700">
          {children}
        </td>
      )
    },
    th({ children, node: _node, ...props }) {
      return (
        <th {...props} className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-semibold dark:border-slate-700 dark:bg-slate-800">
          {children}
        </th>
      )
    },
    ul({ children, node: _node, ...props }) {
      return (
        <ul {...props} className="list-disc space-y-1 pl-5">
          {children}
        </ul>
      )
    },
  }
}

export function plainTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/[*_~>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function FormattedMarkdown({
  markdown,
  className,
  variant = 'block',
}: Props) {
  const components = createMarkdownComponents(variant)

  return (
    <div className={cx('resonance-markdown', variant === 'inline' ? compactText : baseText, variant === 'block' ? 'space-y-3' : 'space-y-1', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowElement={markdownAllowElement}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
