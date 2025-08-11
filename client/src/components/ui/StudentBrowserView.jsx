import React, { useState, useEffect } from "react";

function FragmentTag({ src, hash, onSubmit, initialContent }) {
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [isValid, setIsValid] = useState(null);
    const [wasSubmitted, setWasSubmitted] = useState(false);

    useEffect(() => {
        if (initialContent && !wasSubmitted) {
            setInputValue(initialContent);
            setIsValid(true);
            setWasSubmitted(true);
        }
    }, [initialContent, wasSubmitted]);

    async function createHash(fragment) {
        const buffer = new TextEncoder().encode(fragment);
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    const handleValidate = async () => {
        const computedHash = await createHash(inputValue.trim());
        const valid = computedHash === hash;
        setIsValid(valid);
        if (valid && onSubmit) {
            onSubmit(hash, inputValue.trim());
            setWasSubmitted(true);
            setIsOpen(false);
        }
    };

    if (wasSubmitted) {
        return (
            <span className="text-green-600 font-mono">
                &lt;fragment src="{src}"&gt;{inputValue}&lt;/fragment&gt;
            </span>
        );
    }

    return (
        <div
            className="group relative"
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => !inputValue && setIsOpen(false)}
        >
            {!isOpen ? (
                <span
                    className="text-blue-600 font-mono cursor-pointer"
                    onClick={() => setIsOpen(true)}
                >
                    &lt;fragment src="{src}"&gt;&lt;/fragment&gt;
                </span>
            ) : (
                <div
                    className={`flex flex-col gap-1 p-2 rounded border ${isValid === true ? "border-green-400 bg-green-50" : isValid === false ? "border-red-400 bg-red-50" : "border-blue-300 bg-white"}`}
                >
                    <span className="text-xs font-semibold text-blue-600">Paste fragment for <code>{src}</code>:</span>
                    <textarea
                        className="text-xs font-mono border rounded p-1"
                        rows={3}
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleValidate();
                            }
                        }}
                    />
                    <button
                        onClick={handleValidate}
                        className="bg-blue-500 text-white text-xs px-2 py-1 rounded hover:bg-blue-600"
                    >
                        Check
                    </button>
                    {isValid === true && <div className="text-green-600 text-xs">✓ Fragment verified!</div>}
                    {isValid === false && <div className="text-red-600 text-xs">✗ Fragment does not match hash</div>}
                </div>
            )}
        </div>
    );
}

export default function StudentBrowserView({ template, sessionId }) {
    const [renderedFragments, setRenderedFragments] = useState({});
    const title = template.title;
    const fragments = template.fragments;

    useEffect(() => {
        const stored = localStorage.getItem(`${sessionId}-fragments`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setRenderedFragments(parsed);
            } catch { }
        }
    }, []);

    const handleFragmentSubmit = (hash, content) => {
        setRenderedFragments(prev => {
            const updated = { ...prev, [hash]: content };
            localStorage.setItem(`${sessionId}-fragments`, JSON.stringify(updated));
            return updated;
        });
    };

    if (!fragments || fragments.length === 0) {
        return (
            <>  </>
        );
    }

    return (
        <div className="p-4">
            <h2 className="text-xl font-bold mb-4">{title}</h2>
            <div className="flex flex-col lg:flex-row gap-4">
                {/* Source View */}
                <div className="w-full lg:w-1/2 border border-gray-300 rounded">
                    <div className="bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 border-b border-gray-300 rounded-t">Source HTML</div>
                    <pre className="text-sm whitespace-pre-wrap font-mono p-2 bg-gray-50 rounded-b">
                        {`<html>
  <head>
    <title>${title}</title>
  </head>
  <body>
`}
                        {fragments.map((f, i) => (
                            <React.Fragment key={i}>
                                {"    "}
                                <FragmentTag
                                    src={f.url}
                                    hash={f.hash}
                                    onSubmit={handleFragmentSubmit}
                                    initialContent={renderedFragments[f.hash]}
                                />
                                {"\n"}
                            </React.Fragment>
                        ))}
                        {"  </body>\n</html>"}
                    </pre>
                </div>

                {/* Rendered View */}
                <div className="w-full lg:w-1/2 border border-gray-300 rounded">
                    <div className="bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700 border-b border-gray-300 rounded-t">Rendered View</div>
                    <div className="text-sm text-gray-800 bg-white rounded-b p-2">
                        <h3 className="text-lg font-bold mb-2">{title}</h3>
                        {fragments.map((f, i) => (
                            <React.Fragment key={i}>
                                {renderedFragments[f.hash] ? (
                                    <span className="text-sm text-gray-800 whitespace-pre-wrap">
                                        {renderedFragments[f.hash]}{' '}
                                    </span>
                                ) : (
                                    <div className="italic text-gray-400">Waiting for content from {f.url}</div>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
