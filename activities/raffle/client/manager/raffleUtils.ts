export type RaffleType = 'standard' | 'pair' | 'group'

export function resolveRaffleSelectionSize(
  requestedCount: number,
  ticketCount: number,
  random: () => number = Math.random,
): number | null {
  if (requestedCount === -1) {
    if (ticketCount < 3) {
      return null
    }

    return Math.min(Math.floor(random() * (ticketCount - 3)) + 3, 6)
  }

  if (requestedCount > ticketCount) {
    return null
  }

  return requestedCount
}

export function drawWinningTickets(
  tickets: readonly number[],
  count: number,
  random: () => number = Math.random,
): number[] {
  if (count <= 0 || tickets.length === 0) {
    return []
  }

  const winnerCount = Math.min(count, tickets.length)
  const pool = [...tickets]
  const winners: number[] = []

  // Partial Fisher-Yates: pick unique winners with no retry loop.
  for (let index = 0; index < winnerCount; index += 1) {
    const lastUnpickedIndex = pool.length - index - 1
    const randomIndex = Math.floor(random() * (lastUnpickedIndex + 1))
    const picked = pool[randomIndex]
    const tail = pool[lastUnpickedIndex]

    if (picked === undefined || tail === undefined) {
      break
    }

    pool[randomIndex] = tail
    pool[lastUnpickedIndex] = picked
    winners.push(pool[lastUnpickedIndex])
  }

  return winners
}
