import React, { useState } from "react";

const okHeader = `HTTP/1.1 200 OK\nContent-Type: text/plain`;

function HostedFileChip({ fileName, fragment, header = okHeader }) {
    const [copied, setCopied] = useState(false);
    const fullContent = `${header}\n\n${fragment}`;

    function handleCopy() {
        navigator.clipboard.writeText(fullContent).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 600);
        });
    }

    function handleDragStart(e) {
        e.dataTransfer.setData("text/plain", fullContent);
    }

    return (
        <li className="flex items-center gap-2">
            <div
                className="flex flex-col items-center px-2 py-1 bg-white border border-gray-300 rounded cursor-move"
                draggable
                onDragStart={handleDragStart}
            >
                <span>📄</span>
                <span className="font-mono text-xs mt-1">{fileName}</span>
            </div>
            <button
                onClick={handleCopy}
                className={`text-xs text-blue-600 hover:underline ${copied ? "text-green-600 animate-pulse" : ""}`}
            >
                {copied ? "Copied!" : "Copy with HTTP Header"}
            </button>
        </li>
    );
}

export default function StudentHostPalette({ fragments = [], hostname }) {
    const errorFiles = [
        {
            fileName: "404-File-Not-Found",
            fragment: "Error 404: File not found. Double-check the file name and try again.",
            header: `HTTP/1.1 404 Not Found\nContent-Type: text/plain`,
        },
        {
            fileName: "400-Bad-Request",
            fragment: "Error 400: Bad request. Requests must be in the format 'GET filename'.",
            header: `HTTP/1.1 400 Bad Request\nContent-Type: text/plain`,
        },
    ];

    return (
        <aside className="w-64 p-2 border-r border-gray-300 bg-gray-50">
            <h2 className="font-semibold mb-2 truncate">{hostname}</h2>
            {fragments.length > 0 ? (
                <ul className="space-y-2">
                    {fragments.map(({ fileName, fragment, header }) => (
                        <HostedFileChip key={fileName} fileName={fileName} fragment={fragment} header={header} />
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-gray-500">You are not hosting any files</p>
            )}
            <div className="mt-4 pt-4 border-t border-gray-300">
                <h3 className="text-xs font-semibold text-gray-500 mb-2">Error Messages</h3>
                <ul className="space-y-2">
                    {errorFiles.map(({ fileName, fragment, header }) => (
                        <HostedFileChip key={fileName} fileName={fileName} fragment={fragment} header={header} />
                    ))}
                </ul>
            </div>
        </aside>
    );
}

