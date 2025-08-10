import React, { useState, useRef, useEffect, useMemo } from "react";
import Button from "@src/components/ui/Button";
import StudentFragmentList from "@src/components/ui/StudentFileList";

export default function WwwSim({ sessionData }) {
    const sessionId = sessionData?.id;
    const storageKey = `${sessionId}-wwwsim`;

    const [hostname, setHostname] = useState(() => {
        try {
            return localStorage.getItem(storageKey) || "";
        } catch {
            return "";
        }
    });
    const [connecting, setConnecting] = useState(false);
    const [joined, setJoined] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [selectedTab, setSelectedTab] = useState("server");

    const [assignments, setAssignments] = useState([]);

    useEffect(() => {
        if (!joined || !sessionId) return;

        let protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        let host = window.location.host;
        const ws = new WebSocket(`${protocol}//${host}/ws/www-sim?sessionId=${sessionId}&hostname=${hostname}`);

        ws.addEventListener("message", (event) => {
            try {
                const data = JSON.parse(event.data);
                switch (data.type) {
                    case "student-updated": {
                        const { oldHostname, newHostname } = data.payload;
                        if (oldHostname === hostname) {
                            setHostname(newHostname);
                            localStorage.setItem(storageKey, newHostname);
                            setMessage(`Hostname updated to "${newHostname}"`);
                        }
                        break;
                    }
                    case "student-removed": {
                        const { hostname: removed } = data.payload;
                        if (removed === hostname) {
                            setMessage("You have been removed by the instructor.");
                            setJoined(false);
                            setHostname("");
                            localStorage.removeItem(storageKey);
                        }
                        break;
                    }
                    case "assigned-fragments": {
                        const fragments = data.payload?.assignments || [];                                                
                        setAssignments(fragments);
                        break;
                    }
                }
            } catch (err) {
                console.error("Failed to parse WS message", err);
            }
        });

        ws.addEventListener("error", (err) => {
            console.error("WebSocket error (student)", err);
        });

        return () => ws.close();
    }, [joined, sessionId, hostname]);


    async function handleConnect() {
        if (!sessionId || !hostname || connecting) return;
        const ok = window.confirm(`Join as "${hostname}"?`);
        if (!ok) return;

        setConnecting(true);
        setError("");
        setMessage("Connecting…");
        try {
            const res = await fetch(`/api/www-sim/${sessionData.id}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hostname }),
                credentials: "include",
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `${res.status} ${res.statusText}`);
            }
            const data = await res.json();
            setJoined(true);
            localStorage.setItem(storageKey, hostname);

            setMessage(data.message || "Joined! Waiting for instructor to start…");

            const frags = await fetch(`/api/www-sim/${sessionData.id}/fragments/${hostname}`);
            if (frags.ok) {
                const fragData = await frags.json();
                setAssignments(fragData.payload?.assignments || []);
            }
        } catch (e) {
            setError(e.message || String(e));
            setMessage("");
        } finally {
            setConnecting(false);
        }
    }

    function onKeyDown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            handleConnect();
        }
    }

    if (!sessionData) {
        return <div className="p-6">Loading session…</div>;
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h1 className="text-2xl font-bold">
                    Web Simulation: HTTP & DNS Protocols
                </h1>
                {joined && (
                    <p className="text-green-600 font-mono text-lg">{hostname}</p>
                )}
                <p className="text-gray-600">Join Code: <span className="font-mono">{sessionData.id}</span></p>

            </div>
            {!joined && (
                <div className="flex justify-center sm:flex-row items-center gap-2">
                    <input
                        type="text"
                        placeholder="Enter your hostname from code.org"
                        value={hostname}
                        onChange={(e) => setHostname(e.target.value.trim().toLowerCase())}
                        onKeyDown={onKeyDown}
                        disabled={joined}
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full max-w-xs font-mono"
                    />
                    <Button onClick={handleConnect} disabled={!hostname || connecting}>
                        {connecting ? "Connecting…" : "Connect"}
                    </Button>
                </div>
            )}

            {message && <div className="text-sm text-gray-700" role="status">{message}</div>}
            {error && <div className="text-sm text-red-600" role="alert">{error}</div>}

            {joined && (
                <>
                    <div className="flex gap-2 mt-4 border-b border-gray-300">
                        <button
                            className={`px-3 py-1 text-sm font-medium ${selectedTab === "server" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`}
                            onClick={() => setSelectedTab("server")}
                        >
                            Server
                        </button>
                        <button
                            className={`px-3 py-1 text-sm font-medium ${selectedTab === "browser" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`}
                            onClick={() => setSelectedTab("browser")}
                        >
                            Browser
                        </button>
                    </div>

                    <div className="mt-4">
                        {selectedTab === "server" && (
                            <div className="text-sm text-gray-800">
                                <StudentFragmentList fragments={assignments} hostname={hostname} />
                            </div>
                        )}
                        {selectedTab === "browser" && (
                            <div className="text-sm text-gray-800">
                                {/* Placeholder for browser-side request content */}
                                <p>To request a file, enter a URL above.</p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
