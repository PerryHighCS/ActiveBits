import React, { useEffect, useState } from 'react';

/**
 * Display a list of all tickets created for a raffle, sorted in ascending order.
 * Allows the user to select multiple tickets and displays the total of the selected tickets.
 * @param {Object} props - The component props.
 * @param {Number[]} props.tickets - Array of ticket numbers. 
 * @returns {React.Component} - A component that displays the list of tickets and allows selection.
 */
const TicketsList = ({ tickets }) => {
    const [selected, setSelected] = useState([]);

    // Sort the tickets in ascending order
    tickets.sort((a, b) => a - b);

    const toggleSelected = (ticket) => {
        if (selected.includes(ticket)) {
            setSelected(selected.filter((t) => t !== ticket));
        } else {
            setSelected([...selected, ticket]);
        }
    }

    useEffect(() => {
        const sel = selected.filter((ticket) => tickets.includes(ticket));
        if (sel.length !== selected.length) {
            setSelected(sel);
        }
    }, [tickets]);

    const title = () => {
        let text;

        if (selected.length > 1) {
            const total = selected.reduce((acc, ticket) => acc + ticket, 0);
            text = `${selected.length} / ${tickets.length} Tickets. Total: ${total}`;
        }
        else {
            text = `${tickets.length} Tickets:`;
        }
        return text;
    }

    return (
        (tickets.length > 0) && (
            <div className="w-full p-4">
                <h2 className="text-xl font-bold">{title()}</h2>
                <div className="w-full flex flex-row flex-wrap justify-start">
                    {tickets.map((ticket) => (
                        <div key={ticket} className={`p-2 border border-gray-200 m-2 rounded shadow-md ${selected.includes(ticket) && 'bg-blue-600 text-white'}`} onClick={()=>{toggleSelected(ticket)}}>
                            {ticket}
                        </div>
                    ))}
                </div>
            </div>
        ));
};

export default TicketsList;
