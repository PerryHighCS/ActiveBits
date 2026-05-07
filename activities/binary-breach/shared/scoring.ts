import type { BinaryBreachProgress } from '../binaryBreachTypes.js'

export function createInitialProgress(): BinaryBreachProgress {
  return {
    systemsRestored: 0,
    attempts: 0,
    correct: 0,
    incorrect: 0,
    streak: 0,
    bestStreak: 0,
    hintsUsed: 0,
    traceLevel: 0,
    score: 0,
    completed: false,
  }
}

export function calculateMissionScore(progress: Pick<
  BinaryBreachProgress,
  'systemsRestored' | 'bestStreak' | 'incorrect' | 'hintsUsed' | 'traceLevel'
>): number {
  return Math.max(
    0,
    progress.systemsRestored * 100
      + progress.bestStreak * 25
      - progress.incorrect * 15
      - progress.hintsUsed * 10
      - progress.traceLevel * 20,
  )
}

export function applyAnswerResult(
  progress: BinaryBreachProgress,
  correct: boolean,
  missionLength: number,
): BinaryBreachProgress {
  const next: BinaryBreachProgress = {
    ...progress,
    attempts: progress.attempts + 1,
  }

  if (correct) {
    next.correct += 1
    next.systemsRestored += 1
    next.streak += 1
    next.bestStreak = Math.max(next.bestStreak, next.streak)
  } else {
    next.incorrect += 1
    next.streak = 0
    next.traceLevel += 1
  }

  next.completed = next.systemsRestored >= missionLength
  next.score = calculateMissionScore(next)
  return next
}

export function applyHintUse(progress: BinaryBreachProgress): BinaryBreachProgress {
  const next = {
    ...progress,
    hintsUsed: progress.hintsUsed + 1,
  }
  next.score = calculateMissionScore(next)
  return next
}

