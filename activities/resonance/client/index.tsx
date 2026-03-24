import type { ComponentType } from 'react'
import type {
  ActivityClientModule,
  ActivityPersistentLinkBuilderProps,
  ActivityPersistentSoloLaunchParams,
  ActivityPersistentSoloLaunchResult,
} from '../../../types/activity.js'
import ResonanceManager from './manager/ResonanceManager.js'
import ResonanceStudent from './student/ResonanceStudent.js'
import type { Question } from '../shared/types.js'
import { validateQuestionSet } from '../shared/validation.js'
import ResonancePersistentLinkBuilder from './tools/ResonancePersistentLinkBuilder.js'
import ResonanceToolShell from './tools/ResonanceToolShell.js'

export async function launchResonancePersistentSoloEntry(
  params: ActivityPersistentSoloLaunchParams,
): Promise<ActivityPersistentSoloLaunchResult> {
  const rawEncodedQuestions = params.selectedOptions?.q
  const rawPersistentHash = params.selectedOptions?.h
  const encodedQuestions = typeof rawEncodedQuestions === 'string' ? rawEncodedQuestions.trim() : null
  const persistentHash = typeof rawPersistentHash === 'string' ? rawPersistentHash.trim() : null
  const rawQuestions = params.selectedOptions?.questions
  const validatedQuestionSet = Array.isArray(rawQuestions)
    ? validateQuestionSet(rawQuestions)
    : null
  const validatedQuestions = validatedQuestionSet?.errors.length === 0
    ? validatedQuestionSet.questions
    : []

  if ((!encodedQuestions || !persistentHash) && validatedQuestions.length === 0) {
    throw new Error('Resonance solo entry requires a valid question set.')
  }

  const createResponse = await fetch('/api/resonance/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(encodedQuestions && persistentHash ? { encodedQuestions, persistentHash } : {}),
      ...(validatedQuestions.length > 0 ? { questions: validatedQuestions as Question[] } : {}),
      selfPacedMode: true,
    }),
  })

  if (!createResponse.ok) {
    throw new Error('Failed to create Resonance solo session.')
  }

  const created = (await createResponse.json()) as {
    id?: unknown
  }

  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('Resonance solo session response was invalid.')
  }

  return {
    sessionId: created.id,
  }
}

const resonanceActivity: ActivityClientModule = {
  ManagerComponent: ResonanceManager as ComponentType<unknown>,
  StudentComponent: ResonanceStudent as ComponentType<unknown>,
  UtilComponent: ResonanceToolShell as ComponentType<unknown>,
  PersistentLinkBuilderComponent: ResonancePersistentLinkBuilder as ComponentType<ActivityPersistentLinkBuilderProps>,
  footerContent: null,
  launchPersistentSoloEntry: launchResonancePersistentSoloEntry,
}

export default resonanceActivity
