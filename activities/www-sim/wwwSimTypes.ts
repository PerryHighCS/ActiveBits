export interface PassageDefinition {
  value: string
  title?: string
  label?: string
  adjectives?: string[]
  nouns?: string[]
}

export interface PresetPassage extends PassageDefinition {
  label: string
  title: string
  adjectives: string[]
  nouns: string[]
}

export interface StudentRecord {
  hostname: string
  joined: number
}

export interface FragmentAssignment {
  hostname: string
  fileName: string
}

export interface HostedFragmentRecord {
  fragment: string
  index: number
  assignedTo: FragmentAssignment[]
  hash: string
}

export interface TemplateFragment {
  hash: string
  url: string
}

export interface StudentTemplate {
  title?: string
  fragments: TemplateFragment[]
}

export type StudentTemplateMap = Record<string, StudentTemplate>

export interface HostedFileAssignment {
  fileName: string
  fragment: string
  header?: string
}

export interface WwwSimSessionData extends Record<string, unknown> {
  students: StudentRecord[]
  studentTemplates: StudentTemplateMap
  fragments: HostedFragmentRecord[]
  passage?: PassageDefinition
}
