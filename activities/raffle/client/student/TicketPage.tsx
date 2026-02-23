import { useEffect, useState } from 'react'

interface TicketPageSessionData extends Record<string, unknown> {
  sessionId?: string
  ticketNumber?: number
}

interface TicketPageProps {
  sessionData: TicketPageSessionData
}

interface GenerateTicketResponse {
  ticket?: number
}

export default function TicketPage({ sessionData }: TicketPageProps) {
  const sessionId = sessionData.sessionId
  const storageKey = `session-${sessionId}`

  const [ticket, setTicket] = useState<number | null>(
    typeof sessionData.ticketNumber === 'number' ? sessionData.ticketNumber : null,
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (sessionId == null || ticket != null || typeof window === 'undefined') return

    const timerId = setTimeout(() => {
      setLoading(true)

      fetch(`/api/raffle/generateTicket/${sessionId}`)
        .then((response) => {
          if (response.ok !== true) {
            throw new Error('Failed to generate ticket')
          }

          return response.json() as Promise<GenerateTicketResponse>
        })
        .then((data) => {
          const updated = { ...sessionData, ticketNumber: data.ticket }
          localStorage.setItem(storageKey, JSON.stringify(updated))
          setTicket(typeof data.ticket === 'number' ? data.ticket : null)
        })
        .catch((error) => {
          console.error('Error fetching ticket:', error)
          alert('Error fetching ticket. Please try again.')
        })
        .finally(() => {
          setLoading(false)
        })
    }, 50)

    return () => clearTimeout(timerId)
  }, [sessionId, sessionData, storageKey, ticket])

  return (
    <div className="flex flex-col items-center w-full text-center md:w-max mx-auto border border-gray-300 p-5 rounded-lg shadow-md">
      <h2 className="text-lg font-semibold mb-4">Session ID: {sessionId}</h2>
      {ticket != null ? (
        <div className="text-3xl font-bold text-center">
          Your Ticket Number:{' '}
          {loading ? <>Loading...</> : <span className="text-blue-500 font-extrabold text-6xl">{ticket}</span>}
        </div>
      ) : (
        <div className="text-lg font-semibold">Getting your ticket...</div>
      )}
    </div>
  )
}
