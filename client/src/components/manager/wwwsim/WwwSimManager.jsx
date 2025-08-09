import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Button from "@src/components/ui/Button";
import RosterPill from "@src/components/ui/RosterPill";

/**
 * WwwSimManager
 *
 * Standard flow: Instructor opens page, we create a short-lived www-sim session.
 * If the page reloads, we pull the session id from the route params and display it as the join code.

 */
export default function WwwSimManager() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const [displayCode, setDisplayCode] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [students, setStudents] = useState([]); // [{ hostname, joined }]
    const wsRef = useRef(null);

    useEffect(() => {
        let cancelled = false;

        async function api(path, opts = {}) {
            const res = await fetch(path, {
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                ...opts,
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            return res.json();
        }

        async function run() {
            setBusy(true);
            setError(null);
            try {
                if (sessionId) {
                    // validate/load existing session
                    await api(`/api/www-sim/${sessionId}`);
                    if (!cancelled) setDisplayCode(sessionId);
                } else {
                    // create new session
                    const created = await api(`/api/www-sim/create`, {
                        method: "POST",
                        body: JSON.stringify({ type: "www-sim" }),
                    });
                    if (!cancelled) {
                        setDisplayCode(created.id);
                        navigate(`/manage/www-sim/${created.id}`, { replace: true });
                    }
                }
            } catch (e) {
                if (!cancelled) setError(e.message || String(e));
            } finally {
                if (!cancelled) setBusy(false);
            }
        }

        run();
        return () => { cancelled = true; };
    }, [sessionId, navigate]);

    const studentJoinUrl = displayCode ? `${window.location.origin}/${displayCode}` : "";

    useEffect(() => {
        if (!displayCode) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/www-sim/${displayCode}`, { credentials: "include" });
                if (!res.ok) throw new Error("failed to load roster");
                const data = await res.json();
                if (!cancelled) setStudents(data.students || []);
            } catch (e) {
                console.error(e);
            }
        })();
        return () => { cancelled = true; };
    }, [displayCode]);


    // WebSocket hookup (connect when displayCode exists)
    useEffect(() => {
        if (!displayCode) return;

        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${window.location.host}/ws/www-sim?sessionId=${encodeURIComponent(displayCode)}`;
        const ws = new WebSocket(url);

        wsRef.current?.close();            // close any previous connection
        wsRef.current = ws;

        ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                console.log("Wsock", msg);
                if (msg.type === "student-joined") {
                    console.log("Student joined: ", msg);
                    setStudents(prev => {
                        const { hostname, joined } = msg.payload;
                        const i = prev.findIndex(s => s.hostname === hostname);
                        if (i === -1) return [...prev, { hostname, joined }];
                        
                        const next = prev.slice();
                        next[i] = { ...next[i], joined };
                        return next;
                    });
                } else if (msg.type === "student-removed") {
                    console.log("Student removed: ", msg.payload);
                    setStudents(prev => prev.filter(s => s.hostname !== msg.payload.hostname));
                } else if (msg.type === "student-updated") {
                    console.log("Student updated: ", msg.payload);
                    
                    const { oldHostname, newHostname } = msg.payload;
                    setStudents(prev => prev.map(s => s.hostname === oldHostname ? { ...s, hostname: newHostname } : s));
                }
            } catch { /* ignore parse errors */ }
        };
        
        ws.onerror = (e) => console.warn("WS error", e);
        ws.onclose = () => { /* optional: retry/backoff */ };
        return () =>  { try { ws.close(); } catch {} };
    }, [displayCode]);

    // Handlers for edit/remove
    async function removeStudent(hn) {
        try {
            await fetch(`/api/www-sim/${displayCode}/students/${encodeURIComponent(hn)}`, { method: "DELETE", credentials: "include" });
            // Optimistic; WS will also confirm
            setStudents(prev => prev.filter(s => s.hostname !== hn));
        } catch (e) {
            console.error(e);
        }
    }

    async function renameStudent(oldHn, newHn) {
        newHn = (newHn || "").trim().toLowerCase();
        if (!newHn || newHn === oldHn) return;
        try {
            await fetch(`/api/www-sim/${displayCode}/students/${encodeURIComponent(oldHn)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ newHostname: newHn })
            });
            // Optimistic; WS will also update
            setStudents(prev => prev.map(s => (s.hostname === oldHn ? { ...s, hostname: newHn } : s)));
        } catch (e) {
            console.error(e);
        }
    }

    async function copyLink() {
        if (!studentJoinUrl) return;
        try {
            await navigator.clipboard.writeText(studentJoinUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { }
    }

    return (
        <div className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h1 className="text-2xl font-bold">Web Simulation: HTTP & DNS Protocols</h1>
                {displayCode && (
                    <>
                        <div className="flex items-center gap-2 w-fit">
                            <input
                                value={studentJoinUrl}
                                readOnly
                                onFocus={(e) => e.target.select()}
                                className="field-sizing-content w-100 border border-gray-300 rounded px-2 py-1 text-sm font-mono bg-gray-50"
                            />
                            <Button onClick={copyLink} variant="outline">
                                {copied ? "Copied!" : "Copy"}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm">Join Code:</span>
                            <code className="px-2 py-1 rounded bg-gray-100 font-mono text-lg">{displayCode}</code>
                        </div>
                    </>
                )}
            </div>

            {busy && <p>Loading session…</p>}
            {error && <p className="text-red-600">Error: {error}</p>}

            <h2 className="text-md font-bold">{students.length} student{students.length > 1 ? "s" : ""} connected</h2>
            {/* Roster pills */}
            {students.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {students
                        .slice()
                        .sort((a, b) => a.hostname.localeCompare(b.hostname))
                        .map(s => (
                            <RosterPill
                                key={s.hostname}
                                hostname={s.hostname}
                                onRemove={() => removeStudent(s.hostname)}
                                onRename={(newHn) => renameStudent(s.hostname, newHn)}
                            />
                        ))
                    }
                </div>
            )}
        </div>
    );
}