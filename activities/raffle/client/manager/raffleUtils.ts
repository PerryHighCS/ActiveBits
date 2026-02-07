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

  const winners: number[] = []

  for (let index = 0; index < count; index += 1) {
    let ticket: number

    do {
      ticket = tickets[Math.floor(random() * tickets.length)] as number
    } while (winners.includes(ticket))

    winners.push(ticket)
  }

  return winners
}
