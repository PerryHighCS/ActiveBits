import React, { useState, useEffect } from 'react';

/**
 * Displays the user's ticket for a raffle session.
 *
 * The `sessionId` is provided by the `sessionData` prop and is used to fetch a
 * ticket from the server when one is not already stored. Fetched tickets are
 * saved in `localStorage` to prevent generating multiple tickets for the same
 * session.
 *
 * @returns {React.Component} The TicketPage component.
 */
const TicketPage = ({ sessionData }) => {
    const sessionId = sessionData.sessionId;
    const storageKey = `session-${sessionId}`;
    
    const [ticket, setTicket] = useState(() => sessionData.ticketNumber || null);

    const [loading, setLoading] = useState(false); // loading state for the ticket generation


    /**
     * Effect to fetch the ticket number from the server or local storage.
     * If the ticket number is already stored in local storage, it uses that 
     * instead. The ticket number is stored in local storage to avoid 
     * generating multiple tickets for the same user.
     * 
     * @returns {Function} Cleanup function to clear the timeout.
     */
    useEffect(() => {
        if (!sessionId) return;
        if (ticket) return; // Ticket already fetched

        /**
         * Set a timeout to delay the ticket generation request.
         * This is to prevent multiple requests in quick succession, especially
         * in development mode where React.StrictMode may cause double rendering.
         */
        const timerId = setTimeout(() => {
            setLoading(true);
            // No stored ticket; request one from the API.
            fetch(`/api/raffle/generateTicket/${sessionId}`)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error('Failed to generate ticket');
                    }
                    return response.json();
                })
                .then((data) => {
                    const updated = { ...sessionData, ticketNumber: data.ticket };
                    localStorage.setItem(storageKey, JSON.stringify(updated));
                    setTicket(data.ticket);

                    console.log('sessionData:', sessionData);
                })
                .catch((error) => {
                    console.error('Error fetching ticket:', error);
                    alert('Error fetching ticket. Please try again.');
                })
                .finally(() => {
                    setLoading(false);
                });
        }, 50);

        // Cleanup cancels the fetch timeout if the component unmounts (as in StrictMode)
        return () => clearTimeout(timerId);
    }, [sessionId, sessionData, storageKey, ticket]);

    return (
        <>
            <div className='flex flex-col items-center w-full text-center md:w-max mx-auto border border-gray-300 p-5 rounded-lg shadow-md'>
                <h2 className='text-lg font-semibold mb-4'>Session ID: {sessionId}</h2>
                {ticket ? (
                    <div className='text-3xl font-bold text-center'>
                        Your Ticket Number: {loading ? <>Loading...</> : <span className='text-blue-500 font-extrabold text-6xl'>{ticket}</span>}
                        </div>
                    ) : (
                        <div className='text-lg font-semibold'>
                            Getting your ticket...
                        </div>
                    )}
            </div>
        </>
    );
};

export default TicketPage;
