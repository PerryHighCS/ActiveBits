import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import SessionHeader from '@src/components/common/SessionHeader';
import RaffleLink from './RaffleLink';
import TicketsList from './TicketsList';
import WinnerMessage from './WinnerMessage';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

/** 
 * This component manages the raffle process, including creating a new raffle,
 * deleting an existing raffle, and displaying the list of tickets and winners.
 * It uses the URL search parameters to manage the raffle ID and updates the
 * URL accordingly.
 * @returns {React.Component} The RaffleManager component.
 */
const RaffleManager = () => {
    const [tickets, setTickets] = useState([]);
    const [winners, setWinners] = useState([]);
    const [raffleType, setRaffleType] = useState('standard');
    const [message, setMessageText] = useState('');
    const [buttonUrl, setButtonUrl] = useState('');

    const { sessionId: raffleId } = useParams(); // the session ID from the URL as the raffleId
    const navigate = useNavigate();

    const setMessage = (msg, url = '') => {
        setMessageText(msg);
        setButtonUrl(url);
    };

    // Clear the winners and tickets when the raffleId changes.
    useEffect(() => {
        setWinners([]);
        setTickets([]);
        if (!raffleId) {
            setMessage('Raffle not found. Please create a new raffle.', '/manage');
        }
    }, [raffleId]);

    const handleWsMessage = useCallback((event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'tickets-update') {
                setTickets(data.tickets || []);
                setMessage('');
            } else if (data.type === 'raffle-error') {
                setTickets([]);
                setMessage(data.error || 'Raffle not found.', '/manage');
            }
        } catch (err) {
            console.error('Failed to parse raffle WS message', err);
        }
    }, []);

    const handleWsError = useCallback(() => {
        setMessage('Live updates unavailable. Trying to reconnect...', '');
    }, []);

    const buildWsUrl = useCallback(() => {
        if (!raffleId) return null;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/ws/raffle?raffleId=${raffleId}`;
    }, [raffleId]);

    const { connect, disconnect } = useResilientWebSocket({
        buildUrl: buildWsUrl,
        shouldReconnect: Boolean(raffleId),
        onMessage: handleWsMessage,
        onError: handleWsError,
    });

    useEffect(() => {
        if (!raffleId) {
            disconnect();
            return undefined;
        }
        connect();
        return () => disconnect();
    }, [raffleId, connect, disconnect]);

    /**
     *  Perform the raffle by randomly selecting a given number of tickets from the list of tickets.
     *  @param {number} num - The number of tickets to select.
     *                          -1 - group raffle (3-6 tickets)
     *                          1 - standard raffle (1 ticket)
     *                          2 - pair raffle (2 tickets)
     */
    const raffle = async (num) => {
        // Make sure that the number of tickets requested is not greater than the available tickets
        if (num > tickets.length || (num === -1 && tickets.length < 3)) {
            setMessage('Not enough tickets to run this raffle');
            return;
        }

        if (num === -1) {
            setRaffleType('group');
            num = Math.min(Math.floor(Math.random() * (tickets.length - 3)) + 3, 6);
        }
        else if (num === 1) {
            setRaffleType('standard');
        }
        else if (num === 2) {
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

    return (
        <div className='flex flex-col w-full'>
            <SessionHeader 
                activityName="Raffle"
                sessionId={raffleId}
                // SessionHeader handles session termination/end-session controls
            />
            
            <div className='flex flex-col items-center justify-center w-full p-6 space-y-4'>
            {/* Display a message if there is one */}
            {message && <div className='border rounded border-red-500 p-4 mb-4 w-full max-w-4xl'>
                <div className='text-center mb-2'>{message}</div>
                {buttonUrl && (
                    <div className='flex justify-center'>
                        <Button onClick={() => navigate(buttonUrl)}>OK</Button>
                    </div>
                )}
            </div>
            }
            {/* Display the raffle ID and ticket list if a raffle ID is present */}
            {raffleId &&
                <div className='flex flex-col items-center w-full max-w-4xl border border-gray-300 p-4 rounded-lg shadow-md'>
                    {/* Display the raffle link or the winning raffle total */}
                    {(winners.length === 0) ? (
                        <RaffleLink raffleId={raffleId}></RaffleLink>
                    ) : (
                        <WinnerMessage winners={winners} raffleType={raffleType}></WinnerMessage>
                    )}

                    {/* Display the list of tickets */}
                    <div className='border-t border-b border-gray-300 w-full mt-4'>
                        <TicketsList tickets={tickets} />
                    </div>

                    {/* Display the raffle buttons to run the raffle if there is an minimum number of tickets */}
                    <div className='flex flex-row items-center justify-between w-full p-4'>
                        { (tickets.length > 1) && <Button onClick={()=>raffle(1)}>Standard Raffle</Button> }
                        { (tickets.length > 2) && <Button onClick={()=>raffle(2)}>Pair Raffle</Button> }
                        { (tickets.length > 3) && <Button onClick={()=>raffle(-1)}>Group Raffle</Button> }
                    </div>
                </div>
            }
            </div>
        </div>

    );
}

export default RaffleManager;
