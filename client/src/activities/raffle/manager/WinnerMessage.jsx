import React, { useEffect, useState } from 'react';

/**
 * A React component that displays the total of the winning ticket numbers and
 * a message describing the raffle type. Clicking on the total allows toggling
 * the visibility of the winning ticket numbers.
 * 
 * @param {Object} props - The component props.
 * @param {Number[]} props.winners - Array of winning ticket numbers.
 * @param {string} props.raffleType - Type of the raffle (standard, pair, group). 
 * @returns {React.Component} - A component that displays the winning ticket numbers and a message.
 */
const WinnerMessage = ({ winners, raffleType }) => {
    const [showWinners, setShowWinners] = useState(false); // State to control the visibility of the winning ticket numbers.

    // Clear the winners when the raffleId changes.
    useEffect(() => {
        setShowWinners(false);
    }, [winners]);

    // Calculate the total of the winning ticket numbers.
    const winningTotal = winners.reduce((total, ticket) => total + ticket, 0);
    let winningTitle = '';

    // Set the title based on the raffle type.
    if (raffleType === 'standard') {
        winningTitle = 'The raffle winner is:';
    }
    else if (raffleType === 'pair') {
        winningTitle = 'The raffle winners are the pair whose tickets add up to:';
    }
    else if (raffleType === 'group') {
        winningTitle = 'The raffle winners are the group whose tickets add up to:';
    }

    return (
        <div className='flex flex-col items-center justify-center w-full border border-gray-300 p-4 rounded-lg shadow-md'>
            {/* Display the title describing the winning ticket numbers */}
            <div>
                <h2 className="inline-block border-b border-gray-300 p-4 text-lg font-semibold">{winningTitle}</h2>
            </div>
            
            {/* Display the total of the winning ticket numbers, with a toggle to display the actual winning tickets */}
            <a onClick={()=>setShowWinners(!showWinners)}>
                <h1 className="inline-block p-4 text-blue-500 font-extrabold text-6xl">{winningTotal}</h1>
            </a>

            {/* Display the winning ticket numbers if showWinners is true */}
            {(showWinners && (raffleType !== 'standard')) && (
                <div className="flex flex-row items-center justify-center w-full border-t border-gray-300">
                    {winners.map((ticket, index) => (
                        <div key={index} className="p-2 border border-gray-200 m-2 rounded shadow-md">
                            {ticket}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default WinnerMessage;