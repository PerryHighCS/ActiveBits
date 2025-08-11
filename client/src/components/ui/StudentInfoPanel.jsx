import React, { useState } from "react";

export default function StudentInfoPanel({ hostname, template, hostingMap }) {
    const hostedFiles = Object.values(hostingMap)
        .filter(frag => frag.assignedTo?.some(entry => entry.hostname === hostname))
        .map(frag => {
            const entry = frag.assignedTo.find(e => e.hostname === hostname);
            return {
                fileName: entry.fileName,
                content: frag.fragment
            };
        });

    return (
        <div className="border rounded p-4 bg-white shadow-md mt-4">
            <h3 className="text-xl font-bold mb-2">Student: {hostname}</h3>

            <div className="mb-4">
                <h4 className="font-semibold text-gray-700 mb-1">Hosting files:</h4>
                {hostedFiles.length > 0 ? (
                    <ul className="list-disc list-inside text-sm">
                        {hostedFiles.map((file, index) => (
                            <li key={index}>
                                <span className="font-mono font-semibold">{hostname + "/" + file.fileName}</span>: <span className="text-gray-600">{file.content.slice(0, 100) + (file.content.length > 100 ? "..." : "")}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm italic text-gray-500">None</p>
                )}
            </div>

            <div>
                <h4 className="font-semibold text-gray-700 mb-1">Files they need to request:</h4>
                {template?.fragments?.length > 0 ? (
                    <ul className="list-disc list-inside text-sm">
                        {template.fragments.map((frag, idx) => (
                            <li key={idx} className="font-mono">{frag.url}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm italic text-gray-500">No template assigned</p>
                )}
            </div>
        </div>
    );
}