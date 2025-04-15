import React, { useEffect, useState } from 'react';

const WinnerMessage = ({ winners, raffleType }) => {
    const [showWinners, setShowWinners] = useState(false);

    useEffect(() => {
        setShowWinners(false);
    }, [winners]);

    const winningTotal = winners.reduce((total, ticket) => total + ticket, 0);
    let winningTitle = '';

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
            <div>
                <h2 className="inline-block border-b border-gray-300 p-4 text-lg font-semibold">{winningTitle}</h2>
            </div>
            
            <a onClick={()=>setShowWinners(!showWinners)}>
                <h1 className="inline-block p-4 text-blue-500 font-extrabold text-6xl">{winningTotal}</h1>
            </a>
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