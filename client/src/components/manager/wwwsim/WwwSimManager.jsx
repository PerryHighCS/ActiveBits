import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Button from "@src/components/ui/Button";
import RosterPill from "@src/components/ui/RosterPill";

const presetPassages = [
    {
        label: "Abstraction Explanation",
        value: "In computer networking, abstraction means hiding complicated details so that we can focus on the big picture. When you open a website, you don't have to think about how your message is broken into packets, routed across the country, and reassembled. It just works. Each layer of the network handles its own job, like putting an envelope in a mailbox or translating a sentence into another language. This makes it easier to build reliable systems, because everyone can work on their own layer without needing to understand the whole thing.",
        adjectives: ["clear", "simple", "reliable", "layered", "modular", "transparent", "efficient"],
        nouns: ["signal", "note", "path", "bridge", "bit", "message", "route", "node", "layer", "packet", "stack", "system", "frame"]
    },
    {
        label: "Fantasy",
        value: "In the kingdom of Cybershire, the scroll of TCP/IP weaves together a spellbook of messages. A humble peasant (your browser) casts a spell (an HTTP request), and through layers of arcane incantation, the message reaches the distant Oracle (a web server), who responds with enchanted glyphs (HTML). The villagers need not understand the spirits of Ethernet or the wind-routed DNS familiars—they simply trust the ancient runes of abstraction to carry the magic safely home.",
        adjectives: ["arcane", "enchanted", "ancient", "mystic", "magical", "woven", "layered", "hidden", "otherworldly"],
        nouns: ["scroll", "glyph", "rune", "familiar", "tome", "spellbook", "incantation", "oracle"]
    },
    {
        label: "Historical Fiction",
        value: "In the days of semaphore towers and coded letters, abstraction was a matter of survival. A general didn't care how the message crossed the Alps, only that the signal reached the front lines intact. Today's networks follow the same creed: layer upon layer, each doing its job, concealing the complexity below, ensuring the command rides safely on.",
        adjectives: ["aged", "weathered", "sealed", "coded", "tactical", "encrypted", "layered", "hidden"],
        nouns: ["dispatch", "missive", "cipher", "courier", "banner", "signal", "command"]
    },
    {
        label: "Psychological Drama",
        value: "He didn't need to understand the protocols. Not really. It was enough to know that somewhere, deep beneath the blinking interface, his message was fragmented, encoded, routed, and reassembled. Abstraction was comfort. It was distance. It was the lie he needed to believe: that the machine just worked.",
        adjectives: ["fragmented", "internal", "shadowed", "distanced", "echoing", "hidden"],
        nouns: ["mirror", "fragment", "echo", "mask", "shadow", "message"]
    },
    {
        label: "Science Fiction",
        value: "In the neon-lit datascapes of the future, abstraction is the secret language of interstellar communication. Starships don't beam raw binary at each other, they encapsulate intent in protocols, much like ambassadors speaking through encrypted translators. At every layer, from quantum pulse to hyperpacket, abstraction lets one ship's operating system speak with another's, without either crew knowing—or caring—about the other's wiring. Just as warp drives mask the terror of relativistic math, networking abstractions conceal complexity behind elegant layers.",
        adjectives: ["neon", "quantum", "synthetic", "stellar", "encrypted", "hyper", "interstellar", "elegant"],
        nouns: ["datascape", "protocol", "starship", "layer", "pulse", "core", "drone", "datastream", "signal"]
    },
    {
        label: "Spy Thriller",
        value: "The agent inserts a flash drive into the terminal. Routine, efficient, untraceable. But beneath the calm surface of her data exfiltration lies a shadow war of abstractions. Her message, encoded in HTTP requests and DNS lookups, rides hidden on well-traveled paths, each layer shielding the next. She doesn't need to know how the bits traverse routers or which MAC address her packet wore, only that the abstraction held, and her secret made it to HQ.",
        adjectives: ["covert", "oblique", "stealthy", "encoded", "anonymous", "hidden"],
        nouns: ["file", "drop", "deadzone", "alias", "package", "message", "mark", "target"]
    },
    {
        label: "Western",
        value: "Out on the dusty range, messages didn't ride on horses no more—they rode the wires. And just like a rider swaps horses at every station, data passes through layers, each one takin' care of its own stretch. The rancher don't ask how the telegram gets from Tombstone to Tumbleweed, he just tips his hat when it arrives. That's abstraction for you: trust the trail, not the tack.",
        adjectives: ["dusty", "worn", "gritty", "lonesome", "rusty", "open", "vast"],
        nouns: ["telegram", "rider", "range", "wires", "station", "horse", "cattle", "dust", "trail", "saddle"]
    }
];

function getRandomName(passage) {
    const adjectives = passage?.adjectives || ["strange", "bright", "quick"];
    const nouns = passage?.nouns || ["thing", "signal", "object"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj}-${noun}`;
}

function dividePassage(passage, parts = 5) {
    const words = passage.split(/\s+/);
    const size = Math.ceil(words.length / parts);
    const fragments = [];
    for (let i = 0; i < parts; i++) {
        fragments.push(words.slice(i * size, (i + 1) * size).join(" "));
    }
    return fragments;
}

/**
 * WwwSimManager
 *
 * Standard flow: Instructor opens page, we create a short-lived www-sim session.
 * If the page reloads, we pull the session id from the route params and display it as the join code.

 */
export default function WwwSimManager() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const wsRef = useRef(null);

    const [error, setError] = useState(null);

    const [displayCode, setDisplayCode] = useState(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    const [students, setStudents] = useState([]); // [{ hostname, joined }]
    const [passage, setPassage] = useState(presetPassages[0]);
    const [passageEdit, setCustomVisible] = useState(false);

    const [assignmentLocked, setAssignmentLocked] = useState(false);


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
        return () => { try { ws.close(); } catch { } };
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

    function getRandomUnusedName(usedNames = []) {
        let newName;
        do {
            newName = getRandomName(passage);
        } while (usedNames.includes(newName));
        return newName;
    }

    function generateAssignments(students) {
        const fragments = dividePassage(passage.value);
        const studentAssignments = {};
        const fragmentAssignments = [];

        for (const s of students) {
            studentAssignments[s.hostname] = [];
        }

        // Assign each fragment to one random student
        for (const fragment of fragments) {
            const fragmentRecord = { fragment, assignedTo: [] };

            const student = students[Math.floor(Math.random() * students.length)];
            const fileName = getRandomUnusedName(studentAssignments[student.hostname]);

            studentAssignments[student.hostname].push(fileName);
            fragmentRecord.assignedTo.push({ hostname: student.hostname, fileName });
            fragmentAssignments.push(fragmentRecord);
        }

        // Ensure each student has at least 3 fragments
        for (const student of students) {
            const hostname = student.hostname;

            while (studentAssignments[hostname].length < 3) {
                const randomFragmentIndex = Math.floor(Math.random() * fragments.length);
                if (fragmentAssignments[randomFragmentIndex].assignedTo.some(a => a.hostname === hostname)) continue; // already assigned to this student

                const fileName = getRandomUnusedName(studentAssignments[hostname]);
                studentAssignments[student.hostname].push(fileName);
                fragmentAssignments[randomFragmentIndex].assignedTo.push({ hostname: student.hostname, fileName });
            }
        }

        return fragmentAssignments;
    }

    const assignFragments = async () => {
        const assignments = generateAssignments(students);

        try {
            await fetch(`/api/www-sim/${sessionId}/assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignments })
            });

            setAssignmentLocked(true);

            return assignments;
        } catch (e) {
            console.error("Failed to assign fragments", e);

            return {};
        }
    };


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

            <h2 className="text-md font-bold">{students.length} student{students.length != 1 ? "s" : ""} connected</h2>
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

            {!assignmentLocked && (
                <div className="space-y-2 flex flex-col">
                    <div>
                        <label htmlFor="preset" className="font-semibold">Choose a preset passage:</label>
                        <select
                            id="preset"
                            className="border border-gray-300 rounded px-2 py-2 w-full max-w-md ml-2"
                            onChange={(e) => setPassage(e.target.value)}
                            value={passage}
                        >
                            {presetPassages.map(p => (
                                <option key={p.label} value={p}>{p.label}</option>
                            ))}
                        </select>
                        <Button className="ml-2" onClick={() => setCustomVisible(v => !v)}>
                            {passageEdit ? "Hide" : "View/Edit"}
                        </Button>
                    </div>

                    {passageEdit && (
                        <div className="transition-all duration-200 ease-in-out">
                            <textarea
                                className="w-full h-32 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                                placeholder="Enter your own passage here..."
                                value={passage}
                                onChange={(e) => setPassage(e.target.value)}
                            />
                        </div>
                    )}


                    <div className="pt-4">
                        <Button onClick={assignFragments} disabled={students.length === 0}>
                            Assign Fragments
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}