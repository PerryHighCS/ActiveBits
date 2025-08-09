import React, { useState } from "react";
import Button from "@src/components/ui/Button";

export default function WwwSim({ sessionData }) {
    const [hostname, setHostname] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [joined, setJoined] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    async function handleConnect() {
        if (!sessionData?.id || !hostname || connecting) return;

        // Verify student hostname
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
            setMessage(data.message || "Joined! Waiting for instructor to start…");
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
        </div>
    );
}
