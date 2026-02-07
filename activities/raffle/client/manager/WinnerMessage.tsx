import { useEffect, useMemo, useState } from 'react'
import type { RaffleType } from './raffleUtils'

interface WinnerMessageProps {
  winners: number[]
  raffleType: RaffleType
}

function getWinningTitle(raffleType: RaffleType): string {
  if (raffleType === 'standard') {
    return 'The raffle winner is:'
  }

  if (raffleType === 'pair') {
    return 'The raffle winners are the pair whose tickets add up to:'
  }

  return 'The raffle winners are the group whose tickets add up to:'
}

export default function WinnerMessage({ winners, raffleType }: WinnerMessageProps) {
  const [showWinners, setShowWinners] = useState(false)

  useEffect(() => {
    setShowWinners(false)
  }, [winners])

  const winningTotal = useMemo(
    () => winners.reduce((total, ticket) => total + ticket, 0),
    [winners],
  )

  return (
    <div className="flex flex-col items-center justify-center w-full border border-gray-300 p-4 rounded-lg shadow-md">
      <div>
        <h2 className="inline-block border-b border-gray-300 p-4 text-lg font-semibold">{getWinningTitle(raffleType)}</h2>
      </div>

      <button
        type="button"
        onClick={() => setShowWinners((previous) => !previous)}
        className="inline-block p-4 text-blue-500 font-extrabold text-6xl"
      >
        {winningTotal}
      </button>

      {showWinners && raffleType !== 'standard' && (
        <div className="flex flex-row items-center justify-center w-full border-t border-gray-300">
          {winners.map((ticket) => (
            <div key={ticket} className="p-2 border border-gray-200 m-2 rounded shadow-md">
              {ticket}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
