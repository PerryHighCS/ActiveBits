import React, { useState, useRef, useEffect } from "react";
import Button from "@src/components/ui/Button";
import StudentHostPalette from "@src/components/ui/StudentHostPalette";
import StudentBrowserView from "@src/components/ui/StudentBrowserView";
import DNSLookupTable from "@src/components/ui/DNSLookupTable";
import Modal from "@src/components/ui/Modal";
import Instructions from "@src/components/ui/WwwSimInstructions";

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
    const [showInstructions, setShowInstructions] = useState(false);

    const [hostAssignments, setHostAssignments] = useState([]);
    const [templateRequests, setTemplateRequests] = useState([]);

    const templateRequestsRef = useRef();
    useEffect(() => {
        templateRequestsRef.current = templateRequests;
    }, [templateRequests]);



    useEffect(() => {
        if (!joined || !sessionId) return;

        let protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        let host = window.location.host;
        const ws = new WebSocket(`${protocol}//${host}/ws/www-sim?sessionId=${sessionId}&hostname=${hostname}`);

        ws.addEventListener("message", (event) => {
            try {
                const msg = JSON.parse(event.data);
                switch (msg.type) {
                    case "student-updated": {
                        const { oldHostname, newHostname } = msg.payload;
                        if (oldHostname === hostname) {
                            setHostname(newHostname);
                            localStorage.setItem(storageKey, newHostname);
                            setMessage(`Hostname updated to "${newHostname}"`);
                        }

                        // Update templateRequests fragment URLs
                        if (templateRequestsRef.current?.fragments) {
                            const escaped = oldHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`//${escaped}/`, "g");

                            const next = templateRequestsRef.current.fragments.map(frag => ({
                                ...frag,
                                url: frag.url.replace(regex, `//${newHostname}/`)
                            }));

                            console.log("Updated templateRequests fragments:", next);
                            setTemplateRequests((prev) => ({
                                title: prev.title,
                                ...prev,
                                fragments: next
                            }));
                        }


                        break;
                    }
                   
                    case "student-removed": {
                        const { hostname: removed } = msg.payload;
                        if (removed === hostname) {
                            setMessage("You have been removed by the instructor.");
                            setJoined(false);
                            setHostname("");
                            localStorage.removeItem(storageKey);
                        }
                        break;
                    }
                    case "assigned-fragments": {
                        console.log("Fragments assigned", msg.payload);
                        const { host, requests } = msg.payload || {};
                        setHostAssignments(host || []);
                        setTemplateRequests(requests || []);
                        break;
                    }

                    case "template-assigned": {
                        console.log("template assigned", msg.payload);
                        const {hostname: hn, template} = msg.payload || {};
                        console.log("Got template", template);
                        if (hostname === hn) {
                            setTemplateRequests(template);
                        }
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
    }, [joined, sessionId, hostname, storageKey]);


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
            setShowInstructions(true);
            localStorage.setItem(storageKey, hostname);

            setMessage(data.message || "Joined! Waiting for instructor to start…");

            const frags = await fetch(`/api/www-sim/${sessionData.id}/fragments/${hostname}`);
            if (frags.ok) {
                const fragData = await frags.json();
                setHostAssignments(fragData.payload?.host || []);
                setTemplateRequests(fragData.payload?.requests || []);
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
            <Modal open={showInstructions} onClose={() => setShowInstructions(false)} title="Instructions">
                <Instructions />
            </Modal>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h1 className="text-2xl font-bold">
                    Web Simulation: HTTP & DNS Protocols
                </h1>
                {joined && (
                    <p className="text-green-600 font-mono text-lg">{hostname}</p>
                )}
                <div className="flex items-center gap-2">
                    <p className="text-gray-600">Join Code: <span className="font-mono">{sessionData.id}</span></p>
                    {joined && (
                        <Button variant="outline" onClick={() => setShowInstructions(true)}>
                            Instructions
                        </Button>
                    )}
                </div>

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
                    <div className="flex mt-4 gap-4">
                        <StudentHostPalette fragments={hostAssignments} hostname={hostname} />
                        <div className="flex-1 text-sm text-gray-800 space-y-4">
                            <DNSLookupTable
                                template={templateRequests}
                                initialDns={{}}
                                onChange={(map) => console.log("DNS mapping:", map)}
                                sessionId={sessionId}
                            />

                            <StudentBrowserView template={templateRequests} sessionId={sessionId} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
