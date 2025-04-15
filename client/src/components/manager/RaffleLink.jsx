import React, { useEffect } from 'react';
import {QRCodeSVG} from 'qrcode.react';

const RaffleLink = ({ raffleId }) => {
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