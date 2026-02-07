import { useEffect, useMemo, useState } from 'react'

interface TicketsListProps {
  tickets: number[]
}

function getTitle(selected: number[], tickets: number[]): string {
  if (selected.length > 1) {
    const total = selected.reduce((accumulator, ticket) => accumulator + ticket, 0)
    return `${selected.length} / ${tickets.length} Tickets. Total: ${total}`
  }

  return `${tickets.length} Tickets:`
}

export default function TicketsList({ tickets }: TicketsListProps) {
  const [selected, setSelected] = useState<number[]>([])

  const sortedTickets = useMemo(() => [...tickets].sort((left, right) => left - right), [tickets])

  const toggleSelected = (ticket: number): void => {
    setSelected((previous) =>
      previous.includes(ticket)
        ? previous.filter((selectedTicket) => selectedTicket !== ticket)
        : [...previous, ticket],
    )
  }

  useEffect(() => {
    setSelected((previous) => previous.filter((ticket) => sortedTickets.includes(ticket)))
  }, [sortedTickets])

  if (sortedTickets.length === 0) {
    return null
  }

  return (
    <div className="w-full p-4">
      <h2 className="text-xl font-bold">{getTitle(selected, sortedTickets)}</h2>
      <div className="w-full flex flex-row flex-wrap justify-start">
        {sortedTickets.map((ticket) => (
          <div
            key={ticket}
            className={`p-2 border border-gray-200 m-2 rounded shadow-md ${selected.includes(ticket) ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => {
              toggleSelected(ticket)
            }}
          >
            {ticket}
          </div>
        ))}
      </div>
    </div>
  )
}
