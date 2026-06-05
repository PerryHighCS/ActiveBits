import type { Extension } from '@codemirror/state'
import { getFileExtension } from './fileUtils'

export async function loadLanguageExtension(filename: string): Promise<Extension[]> {
  const extension = getFileExtension(filename)
  switch (extension) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx': {
      const mod = await import('@codemirror/lang-javascript')
      return [mod.javascript({ jsx: extension.endsWith('x'), typescript: extension.startsWith('ts') })]
    }
    case 'java': {
      const mod = await import('@codemirror/lang-java')
      return [mod.java()]
    }
    case 'py': {
      const mod = await import('@codemirror/lang-python')
      return [mod.python()]
    }
    case 'html': {
      const mod = await import('@codemirror/lang-html')
      return [mod.html()]
    }
    case 'css': {
      const mod = await import('@codemirror/lang-css')
      return [mod.css()]
    }
    case 'json': {
      const mod = await import('@codemirror/lang-json')
      return [mod.json()]
    }
    case 'md':
    case 'markdown': {
      const mod = await import('@codemirror/lang-markdown')
      return [mod.markdown()]
    }
    case 'xml': {
      const mod = await import('@codemirror/lang-xml')
      return [mod.xml()]
    }
    case 'sql': {
      const mod = await import('@codemirror/lang-sql')
      return [mod.sql()]
    }
    case 'c':
    case 'cc':
    case 'cpp':
    case 'h':
    case 'hpp': {
      const mod = await import('@codemirror/lang-cpp')
      return [mod.cpp()]
    }
    default:
      return []
  }
}
