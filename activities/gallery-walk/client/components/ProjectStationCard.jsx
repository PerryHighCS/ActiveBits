import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function ProjectStationCard({ projectTitle, joinUrl, fallbackForm }) {
  return (
    <div className="grid gap-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        { projectTitle && 
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{projectTitle}</h2>
          </div>
  }
        <div className="mt-6 flex flex-col items-center gap-4">
          {joinUrl ? (
            <>
              <QRCodeSVG value={joinUrl} size={240} />
              <code className="rounded bg-gray-100 px-3 py-1 text-sm break-all">{joinUrl}</code>
            </>
          ) : (
            <p className="text-gray-500">Preparing QR code…</p>
          )}
          <p className="text-gray-600">Scan this QR code to leave feedback.</p>
        </div>
      </div>
      {fallbackForm}
    </div>
  );
}
