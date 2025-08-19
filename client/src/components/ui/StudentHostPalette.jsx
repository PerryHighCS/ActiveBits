import React, { useState } from "react";

const okHeader = `HTTP/1.1 200 OK\nContent-Type: text/plain`;

function HostedFileChip({ fileName, fragment, hostname }) {
    const [copied, setCopied] = useState(false);
    const path = `${hostname}/${fileName}`;
    const fullContent = `${okHeader}\n\n${fragment}`;

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
                className="flex items-center gap-1 px-2 py-1 bg-white border border-gray-300 rounded cursor-move"
                draggable
                onDragStart={handleDragStart}
            >
                <span>📄</span>
                <span className="font-mono text-xs">{path}</span>
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

export default function StudentHostPalette({ fragments, hostname }) {
    return (
        <aside className="w-64 p-2 border-r border-gray-300 bg-gray-50">
            <h2 className="font-semibold mb-2 truncate">{hostname}</h2>
            {fragments && fragments.length > 0 ? (
                <ul className="space-y-2">
                    {fragments.map(({ fileName, fragment }) => (
                        <HostedFileChip key={fileName} fileName={fileName} fragment={fragment} hostname={hostname} />
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-gray-500">You are not hosting any files</p>
            )}
        </aside>
    );
}

