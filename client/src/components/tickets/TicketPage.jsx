import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '@src/components/ui/Button';

const TicketPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const raffleId = searchParams.get('raffleId');
    const [raffleIdInput, setRaffleIdInput] = useState('');
    const [ticket, setTicket] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleInputChange = (e) => {
        setRaffleIdInput(e.target.value);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (raffleIdInput.trim()) {
            // Update the URL with the entered raffleId.
            setSearchParams({ raffleId: raffleIdInput.trim() });
        }
    };

    useEffect(() => {
        if (!raffleId) return;

        // Use a key unique to the raffle
        const storageKey = `ticket-${raffleId}`;
        const storedTicket = localStorage.getItem(storageKey);

        if (storedTicket) {
            // Ticket is already stored in local storage; set state from stored value.
            setTicket(JSON.parse(storedTicket));
            return;
        }

        const timerId = setTimeout(() => {
            setLoading(true);
            // No stored ticket; request one from the API.
            fetch(`/api/generateTicket/${raffleId}`)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error('Failed to generate ticket');
                    }
                    return response.json();
                })
                .then((data) => {
                    setTicket(data.ticket);
                    console.log(data.ticket);
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
    }, [raffleId]);

    return (
        <>
            {raffleId ? (
                <div className='flex flex-col items-center w-full text-center md:w-max mx-auto border border-gray-300 p-5 rounded-lg shadow-md'>
                    <h2 className='text-lg font-semibold mb-4'>Raffle ID: {raffleId}</h2>
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
                        Raffle ID:
                        <input className='border border-grey-700 rounded mx-2 p-2' size='5' type="text" id='raffleId' value={raffleIdInput} onChange={handleInputChange} />
                    </label>
                    <Button type="submit">Join Raffle</Button>
                </form>
            )}
            
            <div className='text-center text-sm text-gray-500 mt-4 absolute bottom-0 left-0 w-full bg-white border-t border-gray-300 p-4 mx-auto'>
                <p>Note: Raffles are for educational demonstration purposes only. Raffles are automatically deleted after 24 hours.</p>
            </div>
        </>
    );
};

export default TicketPage;