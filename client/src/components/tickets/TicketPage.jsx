import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';

/**
 * TicketPage component allows users to enter a session ID and fetch their
 * ticket number. It uses the URL search parameter will be used for the 
 * sessionId if present, or an input field if not. The ticket number is fetched
 * from the server and stored in local storage to help limit the numbers
 * being generated.
 * 
 * @returns {React.Component} The TicketPage component.
 */
const TicketPage = () => {
    const [sessionIdInput, setSessionIdInput] = useState(''); // the input field for the session ID
    const [ticket, setTicket] = useState(null); // the ticket number fetched from the server
    const [loading, setLoading] = useState(false); // loading state for the ticket generation

    const { sessionId: sessionId } = useParams(); // the session ID from the URL
    const navigate = useNavigate();

    /**
     * Handle input change from the session ID input field.
     * @param {Event} e - The event object from the input change.
     */
    const handleInputChange = (e) => {
        setSessionIdInput(e.target.value);
    };

    /**
     * Handle form submission to set the sessionId used to fetch the ticket 
     * number.
     * @param {Event} e - The event object from the form submission.
     */
    const handleSubmit = (e) => {
        e.preventDefault();
        if (parseInt(sessionIdInput.trim(), 16)) {
            // Update the URL with the entered sessionId.
            navigate('/' + sessionIdInput.trim() );
        }
    };

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

        // Use a key unique to the session
        const storageKey = `session-${sessionId}`;
        const storedTicket = localStorage.getItem(storageKey);

        if (storedTicket) {
            // Ticket is already stored in local storage; set state from stored value.
            setTicket(JSON.parse(storedTicket));
            return;
        }

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
                    setTicket(data.ticket);
                    localStorage.setItem(storageKey, JSON.stringify(data.ticket));
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
    }, [sessionId]);

    return (
        <>
            {/* Display the ticket number if the sessionId has been set, or an input field if not */}
            {sessionId ? (
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
            ) : (
                <form onSubmit={handleSubmit} className='flex flex-col items-center w-max mx-auto'>
                    <label className='block mb-4'>
                        Join Session ID:
                        <input className='border border-grey-700 rounded mx-2 p-2' size='5' type="text" id='sessionId' value={sessionIdInput} onChange={handleInputChange} />
                    </label>
                    <Button type="submit">Join Session</Button>
                </form>
            )}
        </>
    );
};

export default TicketPage;