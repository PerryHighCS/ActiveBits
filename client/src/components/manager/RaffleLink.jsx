import React, { useEffect } from 'react';
import {QRCodeSVG} from 'qrcode.react';

/**
 * A React component that generates a QR code and a clickable link for 
 * generating a ticket for a raffle.
 * 
 * @param {Object} props - The component props.
 * @param {string} props.raffleId - The raffle ID to be used in the URL.
 * @returns {React.Component} - A component that displays a QR code and a 
 *                              clickable link to generate a ticket for the 
 *                              raffle.
 */
const RaffleLink = ({ raffleId }) => {
    // Generate the URL for the raffle using the server's url and the raffleId.
    const url = window.location.protocol + '//' + window.location.host + '/?raffleId=' + raffleId;
   
    return (
        <div className='flex flex-col items-center'>
            <a href={url} target='_blank'>
                <QRCodeSVG value={url} size={256} level="H" className="mx-auto my-4" />
                <h3 className="text-lg font-semibold mb-2">{url}</h3>
            </a>
        </div>
    );
}

export default RaffleLink;