import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorState, StateEffect, StateField, type ChangeDesc, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type ViewUpdate } from '@codemirror/view'
import { useEffect, useMemo, useRef, useState } from 'react'
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

const setRemotePresenceEffect = StateEffect.define<{
  remotePresence: MobCodeEditorPresencePayload | null | undefined
  filename: string
}>()

const remotePresenceField = StateField.define<ReturnType<typeof createRemotePresenceDecorations>>({
  create: () => Decoration.none,
  update: (value, update) => {
    let nextValue = mapRemotePresenceDecorations(value, update.changes)
    for (const effect of update.effects) {
      if (!effect.is(setRemotePresenceEffect)) continue
      nextValue = createRemotePresenceDecorations(effect.value.remotePresence, effect.value.filename)
    }
    return nextValue
  },
  provide: (field) => EditorView.decorations.from(field),
})

const remotePresenceExtension: Extension = remotePresenceField

export function createRemotePresenceDecorations(
  remotePresence: MobCodeEditorPresencePayload | null | undefined,
  filename: string,
) {
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
}

export function mapRemotePresenceDecorations(
  decorations: ReturnType<typeof createRemotePresenceDecorations>,
  changes: ChangeDesc,
) {
  return decorations.map(changes)
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
  const editorViewRef = useRef<EditorView | null>(null)

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
      remotePresenceExtension,
    ],
    [languageExtensions, readOnly],
  )

  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    view.dispatch({
      effects: setRemotePresenceEffect.of({ remotePresence, filename }),
    })
  }, [filename, remotePresence])

  return (
    <CodeMirror
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
      onCreateEditor={(view) => {
        editorViewRef.current = view
        view.dispatch({
          effects: setRemotePresenceEffect.of({ remotePresence, filename }),
        })
      }}
      onChange={(nextValue) => onChange?.(nextValue)}
      onUpdate={onUpdate}
    />
  )
}
