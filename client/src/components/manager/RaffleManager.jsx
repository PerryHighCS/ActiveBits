import React, { useState, useEffect } from 'react';
import { useSearchParams, createSearchParams } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import RaffleLink from './RaffleLink';
import TicketsList from './TicketsList';
import WinnerMessage from './WinnerMessage';

/** 
 * This component manages the raffle process, including creating a new raffle,
 * deleting an existing raffle, and displaying the list of tickets and winners.
 * It uses the URL search parameters to manage the raffle ID and updates the
 * URL accordingly.
 * @returns {React.Component} The RaffleManager component.
 */
const RaffleManager = () => {
    // Obtain current search params and a setter function.
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [tickets, setTickets] = useState([]);
    const [winners, setWinners] = useState([]);
    const [raffleType, setRaffleType] = useState('standard');
    const [message, setMessage] = useState('');

    // Extract the raffleId query parameter.
    let raffleId = searchParams.get('raffleId');

    /**
     *  Create a new raffle by making a request to the server to create a new raffle
     *  and update the URL with the new raffleId.
     *  @returns {Promise<void>}
     */
    let createRaffle = async () => {
        if (!raffleId) {
            setLoading(true);

            try {
                const response = await fetch('/api/raffle/createRaffle');
                if (!response.ok) {
                    throw new Error(`Error: ${response.statusText}`);
                }
                const data = await response.json();
                // The API returns { raffleId: "some-id" }
                const newRaffleId = data.raffleId;
                // Update the query parameters to include the new raffle id.
                setSearchParams({ raffleId: newRaffleId });
                setMessage('');
            } catch (error) {
                alert('Failed to generate raffle id:' + error);
            } finally {
                setLoading(false);
            }
        }
    };

    // Clear the winners and tickets when the raffleId changes.
    useEffect(() => {
        setWinners([]);
        setTickets([]);
    }, [raffleId]);

    /**
     * Clear a specific search parameter from the URL.
     * @param {string} paramName - The name of the search parameter to clear.
     */
    const clearSearchParam = (paramName) => {
        const newSearchParams = new URLSearchParams(searchParams.toString());
        newSearchParams.delete(paramName);
        setSearchParams(createSearchParams(newSearchParams).toString(), { replace: true });
    };

    /**
     * Delete the raffle by making a request to the server to delete the raffle
     * and clear the raffleId from the URL.
     */
    let deleteRaffle = async () => {
        if (raffleId) {
            try {
                const response = await fetch('/api/session/' + raffleId,
                    {
                        method: 'DELETE',
                    }
                );
                if (!response.ok) {
                    throw new Error(`${response.statusText}`, { cause: response, status: response.status });
                }
                const data = await response.json();
                // The API returns { raffleId: "some-id" }
                const successful = data.deleted == raffleId;
                console.log('Deleted raffle:', successful, data);

                if (successful) {
                    // Update the query parameters to remove the raffle id.
                    clearSearchParam('raffleId');
                }
            } catch (error) {
                if (error.status !== 404) {
                    setMessage('Failed to delete raffle id:' + error);
                    clearSearchParam('raffleId');
                }
                else {
                    // If the raffleId is not found, we can just clear it from the URL.
                    clearSearchParam('raffleId');
                }
            } finally {
                setLoading(false);
            }
        }
    }

    // Fetch tickets for the current raffleId every 3 seconds by polling the server to keep the ticket list updated.
    useEffect(() => {
        if (!raffleId) return;

        // Function to fetch tickets
        const fetchTickets = () => {
            fetch(`/api/raffle/listTickets/${raffleId}`)
                .then((response) => {
                    if (!response.ok) {
                        // Handle errors here if necessary
                        throw new Error('Failed to fetch tickets', { cause: response, status: response.status });
                    }
                    setMessage('');
                    return response.json();
                })
                .then((data) => {
                    // Assume the API returns { tickets: [ { id, number }, ... ] }
                    setTickets(data.tickets || []);
                })
                .catch((error) => handleError(error));
        };

        // Fetch immediately
        fetchTickets();
        // And poll every 3 seconds (adjust as needed)
        const intervalId = setInterval(fetchTickets, 3000);
        return () => clearInterval(intervalId);
    }, [raffleId]);

    /**
     *  Perform the raffle by randomly selecting a given number of tickets from the list of tickets.
     *  @param {number} num - The number of tickets to select.
     *                          -1 - group raffle (3-6 tickets)
     *                          1 - standard raffle (1 ticket)
     *                          2 - pair raffle (2 tickets)
     */
    const raffle = async (num) => {
        if (num == -1) {
            setRaffleType('group');
            num = Math.min(Math.floor(Math.random() * (tickets.length - 3)) + 3, 6);
        }
        else if (num == 1) {
            setRaffleType('standard');
        }
        else if (num == 2) {
            setRaffleType('pair');
        }        

        const winningTickets = [];

        for (let i = 0; i < num; i++) {
            let ticket;
            do {
                ticket = tickets[Math.floor(Math.random() * tickets.length)];
            } while (winningTickets.includes(ticket));
            winningTickets.push(ticket);
        }

        console.log('raffle winners', winningTickets);
        setWinners(winningTickets);
    }

    /**
     * Handle errors when fetching tickets. If the raffle is not found, clear the raffleId from the URL.
     * @param {Error} error - The error object.
     */
    const handleError = (error) => {
        if (error.cause && error.cause.status === 404) {
            setMessage('Raffle not found. Please create a new raffle.');
            clearSearchParam('raffleId');          
        }
        else {
            setMessage ('An error occurred while fetching tickets: ' + error);
        }
    }

    return (
        <div className='flex flex-col items-center justify-center w-full'>
            {/* Display a message if there is one */}
            {message && <div className='border rounded border-red-500 p-4 mb-4'>{message}</div>}

            {/* Display the raffle ID and ticket list if a raffle ID is present */}
            {raffleId &&
                <div className='flex flex-col items-center w-full border border-gray-300 p-4 rounded-lg shadow-md'>
                    <div className='flex flex-row items-center justify-between w-full'>
                        <h3 className='text-lg font-semibold block'>Raffle ID: {raffleId}</h3>
                        <Button variant='text' className='block' onClick={() => { deleteRaffle(raffleId) }}>❌</Button>
                    </div>

                    {/* Display the raffle link or the winning raffle total */}
                    {(winners.length === 0) ? (
                        <RaffleLink raffleId={raffleId}></RaffleLink>
                    ) : (
                        <WinnerMessage winners={winners} raffleType={raffleType}></WinnerMessage>
                    )}

                    {/* Display the list of tickets */}
                    <div className='border-t border-b border-gray-300 w-full mt-4'>
                        <TicketsList raffleId={raffleId} tickets={tickets} onError={handleError}></TicketsList>
                    </div>

                    {/* Display the raffle buttons to run the raffle if there is an minimum number of tickets */}
                    <div className='flex flex-row items-center justify-between w-full p-4'>
                        { (tickets.length > 1) && <Button onClick={()=>raffle(1)}>Standard Raffle</Button> }
                        { (tickets.length > 2) && <Button onClick={()=>raffle(2)}>Pair Raffle</Button> }
                        { (tickets.length > 3) && <Button onClick={()=>raffle(-1)}>Group Raffle</Button> }
                    </div>
                </div>
            }

            {/* Display a button to create a new raffle if there is no raffle ID */}
            {!(raffleId) &&
                <Button onClick={() => createRaffle()}>Create a new raffle</Button>
            }

        </div>

    );
}

export default RaffleManager;