import React, { useState } from "react";

const okHeader = `HTTP/1.1 200 OK\nContent-Type: text/plain`;
const notFoundHeader = `HTTP/1.1 404 Not Found\nContent-Type: text/plain`;

function FileElement({ filename, contentElement, responseHeader }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        let rawText = "";
        if (typeof contentElement === "string") {
            rawText = contentElement;
        } else if (contentElement?.type === "textarea" && contentElement.props?.value) {
            rawText = contentElement.props.value;
        } else if (contentElement?.props?.children) {
            rawText = contentElement.props.children;
        }

        const fullContent = `${responseHeader}\n\n${rawText}`;
        navigator.clipboard.writeText(fullContent).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 600);
        });
    };

    const isTextarea = contentElement?.type === "textarea";

    return (
        <div className={`border border-gray-300 rounded mb-4 overflow-hidden ${copied ? "ring-2 ring-green-400" : ""}`}>
            <div className="bg-gray-100 px-2 py-1 flex justify-between items-center">
                <span className="font-mono text-sm">{filename}</span>
                <button
                    onClick={handleCopy}
                    className={`text-xs text-blue-600 hover:underline transition duration-150 ${
                        copied ? "animate-pulse text-green-600" : ""
                    }`}
                >
                    {copied ? "Copied!" : "Copy with HTTP Header"}
                </button>
            </div>
            <div className={`p-2 bg-white text-sm font-mono whitespace-pre-wrap ${isTextarea ? "" : "select-none"}`}>
                {contentElement}
            </div>
        </div>
    );
}

function HostedFile({ filename, hostname, content = "", responseHeader = okHeader}) {
    const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;

    return (
        <FileElement 
            key={filename} 
            filename={`${hostname}/${filename}`} 
            contentElement={<pre>{preview}</pre>} 
            responseHeader={responseHeader} 
        />
    );
}

function ErrorMessage() {
    const [message, setMessage] = useState("That file does not exist or cannot be accessed.");

    return (
        <FileElement
            filename="404"
            contentElement={
                <textarea
                    className="w-full bg-white border-none font-mono text-sm resize-none"
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                />
            }
            responseHeader={notFoundHeader}
        />
    );
}

export default function StudentFileDisplay({ fragments, hostname }) {
    return (
        <>
            <div className="mt-4">
                <h2 className="text-lg font-semibold mb-2">Your Hosted Files</h2>
                {fragments.map(({fileName, fragment}) => (
                    <HostedFile key={fileName} hostname={hostname} filename={fileName} content={fragment} />
                ))}
            </div>
            <div className="mt-4">
                <h2 className="text-lg font-semibold mb-2">Error Messages</h2>
                <ErrorMessage />
            </div>
        </>
    );
}
