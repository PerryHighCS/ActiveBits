import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '@src/components/ui/Button'
import SessionHeader from '@src/components/common/SessionHeader'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import RaffleLink from './RaffleLink'
import TicketsList from './TicketsList'
import WinnerMessage from './WinnerMessage'
import { drawWinningTickets, resolveRaffleSelectionSize, type RaffleType } from './raffleUtils'

interface RaffleWsMessage {
  type?: string
  tickets?: number[]
  error?: string
}

/**
 * Intentional manager-facing audit trail:
 * manager runs can inspect winning ticket numbers in the browser console
 * without showing them in the projected/student UI.
 */
const logWinningTicketsForManager = (winningTickets: number[]): void => {
  console.log('[raffle:manager] winning tickets', winningTickets)
}

export default function RaffleManager() {
  const [tickets, setTickets] = useState<number[]>([])
  const [winners, setWinners] = useState<number[]>([])
  const [raffleType, setRaffleType] = useState<RaffleType>('standard')
  const [message, setMessageText] = useState('')
  const [buttonUrl, setButtonUrl] = useState('')

  const { sessionId: raffleId } = useParams()
  const navigate = useNavigate()

  const setMessage = (value: string, url = ''): void => {
    setMessageText(value)
    setButtonUrl(url)
  }

  useEffect(() => {
    setWinners([])
    setTickets([])

    if (raffleId == null) {
      setMessage('Raffle not found. Please create a new raffle.', '/manage')
    }
  }, [raffleId])

  const handleWsMessage = useCallback((event: MessageEvent): void => {
    try {
      const data = JSON.parse(String(event.data)) as RaffleWsMessage
      if (data.type === 'tickets-update') {
        setTickets(Array.isArray(data.tickets) ? data.tickets : [])
        setMessage('')
      } else if (data.type === 'raffle-error') {
        setTickets([])
        setMessage(data.error || 'Raffle not found.', '/manage')
      }
    } catch (error) {
      console.error('Failed to parse raffle WS message', error)
    }
  }, [])

  const handleWsError = useCallback(() => {
    setMessage('Live updates unavailable. Trying to reconnect...', '')
  }, [])

  const buildWsUrl = useCallback((): string | null => {
    if (raffleId == null || typeof window === 'undefined') return null

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/raffle?raffleId=${raffleId}`
  }, [raffleId])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(raffleId),
    onMessage: handleWsMessage,
    onError: handleWsError,
  })

  useEffect(() => {
    if (raffleId == null) {
      disconnect()
      return undefined
    }

    connect()
    return () => disconnect()
  }, [raffleId, connect, disconnect])

  const raffle = async (requestedCount: number): Promise<void> => {
    const selectionSize = resolveRaffleSelectionSize(requestedCount, tickets.length)
    if (selectionSize === null) {
      setMessage('Not enough tickets to run this raffle')
      return
    }

    if (requestedCount === -1) {
      setRaffleType('group')
    } else if (requestedCount === 2) {
      setRaffleType('pair')
    } else {
      setRaffleType('standard')
    }

    const winningTickets = drawWinningTickets(tickets, selectionSize)
    logWinningTicketsForManager(winningTickets)
    setWinners(winningTickets)
  }

  return (
    <div className="flex flex-col w-full">
      <SessionHeader activityName="Raffle" sessionId={raffleId} />

      <div className="flex flex-col items-center justify-center w-full p-6 space-y-4">
        {message && (
          <div className="border rounded border-red-500 p-4 mb-4 w-full max-w-4xl">
            <div className="text-center mb-2">{message}</div>
            {buttonUrl && (
              <div className="flex justify-center">
                <Button onClick={() => navigate(buttonUrl)}>OK</Button>
              </div>
            )}
          </div>
        )}

        {raffleId && (
          <div className="flex flex-col items-center w-full max-w-4xl border border-gray-300 p-4 rounded-lg shadow-md">
            {winners.length === 0 ? (
              <RaffleLink raffleId={raffleId} />
            ) : (
              <WinnerMessage winners={winners} raffleType={raffleType} />
            )}

            <div className="border-t border-b border-gray-300 w-full mt-4">
              <TicketsList tickets={tickets} />
            </div>

            <div className="flex flex-row items-center justify-between w-full p-4">
              {tickets.length > 1 && <Button onClick={() => void raffle(1)}>Standard Raffle</Button>}
              {tickets.length > 2 && <Button onClick={() => void raffle(2)}>Pair Raffle</Button>}
              {tickets.length > 3 && <Button onClick={() => void raffle(-1)}>Group Raffle</Button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
