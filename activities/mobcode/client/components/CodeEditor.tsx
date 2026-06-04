import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type ViewUpdate } from '@codemirror/view'
import { useEffect, useMemo, useState } from 'react'
import type { MobCodeEditorPresencePayload, MobCodeThemeId } from '../../shared/types'
import { loadLanguageExtension } from '../utils/languageMap'

interface CodeEditorProps {
  value: string
  filename: string
  readOnly?: boolean
  theme: MobCodeThemeId
  onChange?: (value: string) => void
  onUpdate?: (viewUpdate: ViewUpdate) => void
  remotePresence?: MobCodeEditorPresencePayload | null
}

class RemoteCursorWidget extends WidgetType {
  toDOM() {
    const cursor = document.createElement('span')
    cursor.className = 'mobcode-remote-cursor'
    cursor.setAttribute('aria-hidden', 'true')

    const label = document.createElement('span')
    label.className = 'mobcode-remote-cursor-label'
    label.textContent = '🧑‍🏫'
    cursor.appendChild(label)

    return cursor
  }
}

function createRemotePresenceExtension(
  remotePresence: MobCodeEditorPresencePayload | null | undefined,
  filename: string,
): Extension {
  return StateField.define({
    create: () => {
      if (!remotePresence || remotePresence.path !== filename) {
        return Decoration.none
      }

      const decorations = remotePresence.selections.flatMap((selection) => {
        const from = Math.min(selection.anchor, selection.head)
        const to = Math.max(selection.anchor, selection.head)
        const nextDecorations = []
        if (from !== to) {
          nextDecorations.push(Decoration.mark({ class: 'mobcode-remote-selection' }).range(from, to))
        }
        nextDecorations.push(Decoration.widget({
          widget: new RemoteCursorWidget(),
          side: 1,
        }).range(selection.head))
        return nextDecorations
      })

      return Decoration.set(decorations, true)
    },
    update: (value) => value,
    provide: (field) => EditorView.decorations.from(field),
  })
}

export function resolveEditorTheme(theme: MobCodeThemeId) {
  if (theme === 'one-dark') return oneDark
  if (theme === 'github-light') return githubLight
  if (theme === 'github-dark') return githubDark
  return 'light'
}

export default function CodeEditor({
  value,
  filename,
  readOnly = false,
  theme,
  onChange,
  onUpdate,
  remotePresence,
}: CodeEditorProps) {
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

  const remotePresenceKey = useMemo(() => {
    if (!readOnly || !remotePresence || remotePresence.path !== filename) {
      return filename
    }
    return `${filename}:${remotePresence.selections.map((selection) => `${selection.anchor}-${selection.head}`).join(',')}`
  }, [filename, readOnly, remotePresence])

  const extensions = useMemo(
    () => [
      ...languageExtensions,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      createRemotePresenceExtension(remotePresence, filename),
    ],
    [filename, languageExtensions, readOnly, remotePresence],
  )

  return (
    <CodeMirror
      key={remotePresenceKey}
      value={value}
      height="100%"
      basicSetup={{
        autocompletion: false,
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        bracketMatching: true,
      }}
      extensions={extensions}
      theme={resolveEditorTheme(theme)}
      onChange={(nextValue) => onChange?.(nextValue)}
      onUpdate={onUpdate}
    />
  )
}
