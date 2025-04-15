import React, { useState, useEffect } from 'react';
import { useSearchParams, createSearchParams } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import RaffleLink from './RaffleLink';
import TicketsList from './TicketsList';
import WinnerMessage from './WinnerMessage';

const RaffleManager = () => {
    // Obtain current search params and a setter function.
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [tickets, setTickets] = useState([]);
    const [winners, setWinners] = useState([]);
    const [raffleType, setRaffleType] = useState('standard');

    // Extract the raffleId query parameter.
    let raffleId = searchParams.get('raffleId');

    let createRaffle = async () => {
        if (!raffleId) {
            setLoading(true);

            try {
                const response = await fetch('/api/createRaffle');
                if (!response.ok) {
                    throw new Error(`Error: ${response.statusText}`);
                }
                const data = await response.json();
                // The API returns { raffleId: "some-id" }
                const newRaffleId = data.raffleId;
                // Update the query parameters to include the new raffle id.
                setSearchParams({ raffleId: newRaffleId });
            } catch (error) {
                alert('Failed to generate raffle id:' + error);
            } finally {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        setWinners([]);
        setTickets([]);
    }, [raffleId]);

    const clearSearchParam = (paramName) => {
        const newSearchParams = new URLSearchParams(searchParams.toString());
        newSearchParams.delete(paramName);
        setSearchParams(createSearchParams(newSearchParams).toString(), { replace: true });
    };

    let deleteRaffle = async () => {
        if (raffleId) {
            try {
                const response = await fetch('/api/raffle/' + raffleId,
                    {
                        method: 'DELETE',
                    }
                );
                if (!response.ok) {
                    throw new Error(`${response.statusText}`);
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
                alert('Failed to delete raffle id:' + error);
                clearSearchParam('raffleId');
            } finally {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (!raffleId) return;

        // Function to fetch tickets
        const fetchTickets = () => {
            fetch(`/api/listTickets/${raffleId}`)
                .then((response) => {
                    if (!response.ok) {
                        // Handle errors here if necessary
                        throw new Error('Failed to fetch tickets');
                    }
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

    const handleError = (error) => {
        // console.error('Error:', error);
        // clearSearchParam('raffleId');
    }

    return (
        <div className='flex flex-col items-center justify-center w-full'>
            {raffleId &&
                <div className='flex flex-col items-center w-full border border-gray-300 p-4 rounded-lg shadow-md'>
                    <div className='flex flex-row items-center justify-between w-full'>
                        <h3 className='text-lg font-semibold block'>Raffle ID: {raffleId}</h3>
                        <Button variant='text' className='block' onClick={() => { deleteRaffle(raffleId) }}>❌</Button>
                    </div>
                    {(winners.length === 0) ? (
                        <RaffleLink raffleId={raffleId}></RaffleLink>
                    ) : (
                        <WinnerMessage winners={winners} raffleType={raffleType}></WinnerMessage>
                    )}

                    <div className='border-t border-b border-gray-300 w-full mt-4'>
                        <TicketsList raffleId={raffleId} tickets={tickets} onError={handleError}></TicketsList>
                    </div>
                    <div className='flex flex-row items-center justify-between w-full p-4'>
                        { (tickets.length > 1) && <Button onClick={()=>raffle(1)}>Standard Raffle</Button> }
                        { (tickets.length > 2) && <Button onClick={()=>raffle(2)}>Pair Raffle</Button> }
                        { (tickets.length > 3) && <Button onClick={()=>raffle(-1)}>Group Raffle</Button> }
                    </div>
                </div>
            }
            {!(raffleId) &&
                <Button onClick={() => createRaffle()}>Create a new raffle</Button>
            }

            {!(loading) &&
                <>
                </>
            }
        </div>

    );
}

export default RaffleManager;