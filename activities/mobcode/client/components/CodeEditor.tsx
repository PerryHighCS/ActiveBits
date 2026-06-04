import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useMemo, useState } from 'react'
import type { MobCodeThemeId } from '../../shared/types'
import { loadLanguageExtension } from '../utils/languageMap'

interface CodeEditorProps {
  value: string
  filename: string
  readOnly?: boolean
  theme: MobCodeThemeId
  onChange?: (value: string) => void
}

function resolveTheme(theme: MobCodeThemeId) {
  if (theme === 'one-dark') return oneDark
  if (theme === 'github-light') return githubLight
  if (theme === 'github-dark') return githubDark
  return 'light'
}

export default function CodeEditor({ value, filename, readOnly = false, theme, onChange }: CodeEditorProps) {
  const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([])

  useEffect(() => {
    let cancelled = false
    void loadLanguageExtension(filename).then((extensions) => {
      if (!cancelled) setLanguageExtensions(extensions)
    })
    return () => {
      cancelled = true
    }
  }, [filename])

  const extensions = useMemo(
    () => [
      ...languageExtensions,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ],
    [languageExtensions, readOnly],
  )

  return (
    <CodeMirror
      value={value}
      height="100%"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        bracketMatching: true,
      }}
      extensions={extensions}
      theme={resolveTheme(theme)}
      onChange={(nextValue) => onChange?.(nextValue)}
    />
  )
}
