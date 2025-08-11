import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, data } from "react-router-dom";
import Button from "@src/components/ui/Button";
import RosterPill from "@src/components/ui/RosterPill";
import StudentInfoPanel from "../../ui/StudentInfoPanel";

const presetPassages = [
    {
        label: "Abstraction Explanation",
        title: "Understanding Abstraction in Networking",
        value: "In computer networking, abstraction means hiding complicated details so that we can focus on the big picture. When you open a website, you don't have to think about how your message is broken into packets, routed across the country, and reassembled. It just works. Each layer of the network handles its own job, like putting an envelope in a mailbox or translating a sentence into another language. This makes it easier to build reliable systems, because everyone can work on their own layer without needing to understand the whole thing.",
        adjectives: ["clear", "simple", "reliable", "layered", "modular", "transparent", "efficient"],
        nouns: ["signal", "note", "path", "bridge", "bit", "message", "route", "node", "layer", "packet", "stack", "system", "frame"]
    },
    {
        label: "Fantasy",
        title: "The Spellbook of Cybershire",
        value: "In the kingdom of Cybershire, the scroll of TCP/IP weaves together a spellbook of messages. A humble peasant (your browser) casts a spell (an HTTP request), and through layers of arcane incantation, the message reaches the distant Oracle (a web server), who responds with enchanted glyphs (HTML). The villagers need not understand the spirits of Ethernet or the wind-routed DNS familiars—they simply trust the ancient runes of abstraction to carry the magic safely home.",
        adjectives: ["arcane", "enchanted", "ancient", "mystic", "magical", "woven", "layered", "hidden", "otherworldly"],
        nouns: ["scroll", "glyph", "rune", "familiar", "tome", "spellbook", "incantation", "oracle"]
    },
    {
        label: "Historical Fiction",
        title: "Signals Across the Alps",
        value: "In the days of semaphore towers and coded letters, abstraction was a matter of survival. A general didn't care how the message crossed the Alps, only that the signal reached the front lines intact. Today's networks follow the same creed: layer upon layer, each doing its job, concealing the complexity below, ensuring the command rides safely on.",
        adjectives: ["aged", "weathered", "sealed", "coded", "tactical", "encrypted", "layered", "hidden"],
        nouns: ["dispatch", "missive", "cipher", "courier", "banner", "signal", "command"]
    },
    {
        label: "Psychological Drama",
        title: "The Fragmented Mind",
        value: "He didn't need to understand the protocols. Not really. It was enough to know that somewhere, deep beneath the blinking interface, his message was fragmented, encoded, routed, and reassembled. Abstraction was comfort. It was distance. It was the lie he needed to believe: that the machine just worked.",
        adjectives: ["fragmented", "internal", "shadowed", "distanced", "echoing", "hidden"],
        nouns: ["mirror", "fragment", "echo", "mask", "shadow", "message"]
    },
    {
        label: "Science Fiction",
        title: "Encrypted Ambassadors of the Stars",
        value: "In the neon-lit datascapes of the future, abstraction is the secret language of interstellar communication. Starships don't beam raw binary at each other, they encapsulate intent in protocols, much like ambassadors speaking through encrypted translators. At every layer, from quantum pulse to hyperpacket, abstraction lets one ship's operating system speak with another's, without either crew knowing—or caring—about the other's wiring. Just as warp drives mask the terror of relativistic math, networking abstractions conceal complexity behind elegant layers.",
        adjectives: ["neon", "quantum", "synthetic", "stellar", "encrypted", "hyper", "interstellar", "elegant"],
        nouns: ["datascape", "protocol", "starship", "layer", "pulse", "core", "drone", "datastream", "signal"]
    },
    {
        label: "Spy Thriller",
        title: "The Abstraction Shield and the Hidden Path",
        value: "The agent inserts a flash drive into the terminal. Routine, efficient, untraceable. But beneath the calm surface of her data exfiltration lies a shadow war of abstractions. Her message, encoded in HTTP requests and DNS lookups, rides hidden on well-traveled paths, each layer shielding the next. She doesn't need to know how the bits traverse routers or which MAC address her packet wore, only that the abstraction held, and her secret made it to HQ.",
        adjectives: ["covert", "oblique", "stealthy", "encoded", "anonymous", "hidden"],
        nouns: ["file", "drop", "deadzone", "alias", "package", "message", "mark", "target"]
    },
    {
        label: "Western",
        title: "Messages on the Wire",
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
    const [showFragments, setShowFragments] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState(null);

    const [assignmentLocked, setAssignmentLocked] = useState(false);
    const [fragments, setFragments] = useState([]);
    const [hostingMap, setHostingMap] = useState([]);
    const [studentTemplates, setStudentTemplates] = useState({});

    const hostingMapRef = useRef(hostingMap);
    const studentTemplatesRef = useRef(studentTemplates);
    const studentsRef = useRef(students);
    const selectedStudentRef = useRef(selectedStudent);

    useEffect(() => { hostingMapRef.current = hostingMap; }, [hostingMap]);
    useEffect(() => { studentTemplatesRef.current = studentTemplates; }, [studentTemplates]);
    useEffect(() => { studentsRef.current = students; }, [students]);
    useEffect(() => { selectedStudentRef.current = selectedStudent; }, [selectedStudent]);

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
                    const session = await api(`/api/www-sim/${sessionId}`);
                    console.log("Loaded session", session);

                    setStudents(session.students || []);

                    if (session.hostingMap && session.hostingMap.length > 0 &&
                        session.studentTemplates && Object.keys(session.studentTemplates).length > 0) {
                        setHostingMap(session.hostingMap || []);
                        setStudentTemplates(session.studentTemplates || []);
                        setFragments(session.hostingMap.map(f => f.fragment));
                        setAssignmentLocked(true);
                    }

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

    useEffect(() => {
        if (studentTemplates.length > 0 && !passage) {
            const example = studentTemplates[0];
            const matched = presetPassages.find(p => p.title === example.title);
            if (matched) setPassage(matched.value);
        }
    }, [studentTemplates, passage]);

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

        ws.onmessage = async (evt) => {
            let msg;
            try { msg = JSON.parse(evt.data); } catch { return; }

            if (msg.type === "student-joined") {
                // If a student has joined
                console.log("Student joined: ", msg);

                // Update student list
                setStudents(prev => {
                    const { hostname, joined } = msg.payload;
                    const i = prev.findIndex(s => s.hostname === hostname);
                    if (i === -1) return [...prev, { hostname, joined }];

                    const next = prev.slice();
                    next[i] = { ...next[i], joined };
                    return next;
                });

                // If fragments have been locked, assign a read-only template to this student if necessary
                if (hostingMap.length > 0 && studentTemplates) {
                    const hostname = msg.payload.hostname;
                    if (!(studentTemplates[hostname])) { // the student hasn't been assigned a template
                        const template = generateHtmlTemplate(hostname, hostingMap, passage.title);

                        console.log("Assigning template to ", hostname, template);

                        fetch(`/api/www-sim/${sessionId}/assign`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ hostname: hostname, template: template })
                        }).catch(e => console.warn("Failed to push template", e));
                    }
                }
            } else if (msg.type === "student-removed") {
                // If a student has been removed, update the student list
                console.log("Student removed: ", msg.payload);
                setStudents(prev => prev.filter(s => s.hostname !== msg.payload.hostname));

                if (msg.payload.hostname === selectedStudent?.hostname) {
                    setSelectedStudent(null);
                }

            } else if (msg.type === "student-updated") {
                // If a student has been updated, update the student list
                console.log("Student updated: ", msg.payload);

                const { oldHostname: oldName, newHostname: newName } = msg.payload;
                const nextHostingMap = hostingMapRef.current.map((fragment) => ({
                    ...fragment,
                    assignedTo: fragment.assignedTo.map(assn => ({
                        ...assn,
                        hostname: assn.hostname === oldName ? newName : assn.hostname
                    }))
                })
                );

                const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`//${escaped}/`, "g");

                const nextTemplates = Object.fromEntries(Object.entries(studentTemplatesRef.current).map(([hostname, template]) =>
                    [hostname === oldName ? newName : hostname, {
                        ...template,
                        fragments: template.fragments.map((fragment) => ({
                            ...fragment,
                            url: fragment.url.replace(regex, `//${newName}/`)
                        }))
                    }]
                ));

                const nextRoster = studentsRef.current.map((s) => (s.hostname === oldName ? { ...s, hostname: newName } : s));

                // Commit updates using functional setters, then sync refs
                setHostingMap(() => nextHostingMap);
                setStudentTemplates(() => nextTemplates);
                setStudents(() => nextRoster);
                hostingMapRef.current = nextHostingMap;
                studentTemplatesRef.current = nextTemplates;
                studentsRef.current = nextRoster;

                if (selectedStudentRef.current?.hostname === oldName) {
                    setSelectedStudent({ ...selectedStudentRef.current, hostname: newName });
                }

            } else if (msg.type === "fragments-assigned") {
                // If fragments have been assigned
                console.log("Fragments assigned: ", msg.payload);

                // Update hosting map, student templates, and the list of fragments
                const { studentTemplates: st, hostingMap: hm } = msg.payload;
                setStudentTemplates(st || []);
                setHostingMap(hm || []);
                setFragments(hm.map(f => f.fragment));

                // Lock the assignment feature
                const lock = !(!st || !hm);
                setAssignmentLocked(lock);

            } else if (msg.type === "template-assigned") {
                // If a template has been assigned to a student
                console.log("Template assigned to: ", msg.payload?.hostname);

                const { hostname, template } = msg.payload;
                setStudentTemplates(prev => ({
                    ...prev,
                    [hostname]: template
                }));
            }
        };

        ws.onerror = (e) => console.warn("WS error", e);
        ws.onclose = () => { /* optional: retry/backoff */ };
        return () => { try { ws.close(); } catch { } };
    }, [displayCode, studentTemplates, hostingMap]);

    // Handler for removing student pill
    async function removeStudent(hn) {
        try {
            await fetch(`/api/www-sim/${displayCode}/students/${encodeURIComponent(hn)}`, { method: "DELETE", credentials: "include" });
            // Optimistic; WS will also confirm
            setStudents(prev => prev.filter(s => s.hostname !== hn));
        } catch (e) {
            console.error(e);
        }
    }

    // Handler for renaming a student
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
            //setStudents(prev => prev.map(s => (s.hostname === oldHn ? { ...s, hostname: newHn } : s)));
        } catch (e) {
            console.error(e);
        }
    }

    // Handler for copying student join link
    async function copyLink() {
        if (!studentJoinUrl) return;
        try {
            await navigator.clipboard.writeText(studentJoinUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { }
    }

    // Generate a random, unused name
    function getRandomUnusedName(usedNames = []) {
        let newName;
        do {
            newName = getRandomName(passage);
        } while (usedNames.includes(newName));
        return newName;
    }

    // Create a SHA-256 hash of a fragment
    async function createHash(fragment) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fragment));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // Create a hosting map for the students to host fragments with random filenames
    async function createHostingMap(students) {
        const fragments = dividePassage(passage.value);
        const studentHostingMap = {};
        const fragmentHostingMap = [];

        setFragments(fragments); // Store fragments for later use

        // Initialize student hosting map with all students hosting no files
        for (const s of students) {
            studentHostingMap[s.hostname] = [];
        }

        // Assign each fragment to one random student
        for (const index in fragments) {
            const fragment = fragments[index];
            const fragmentRecord = { fragment, index, assignedTo: [], hash: await createHash(fragment) };

            const student = students[Math.floor(Math.random() * students.length)];
            const fileName = getRandomUnusedName(studentHostingMap[student.hostname]);

            studentHostingMap[student.hostname].push(fileName);
            fragmentRecord.assignedTo.push({ hostname: student.hostname, fileName });
            fragmentHostingMap.push(fragmentRecord);
        }

        // Ensure each student has at least 3 fragments
        for (const student of students) {
            const hostname = student.hostname;

            while (studentHostingMap[hostname].length < 3) {
                const randomFragmentIndex = Math.floor(Math.random() * fragments.length);
                if (fragmentHostingMap[randomFragmentIndex].assignedTo.some(a => a.hostname === hostname)) continue; // already assigned to this student

                const fileName = getRandomUnusedName(studentHostingMap[hostname]);
                studentHostingMap[student.hostname].push(fileName);
                fragmentHostingMap[randomFragmentIndex].assignedTo.push({ hostname: student.hostname, fileName });
            }
        }

        return fragmentHostingMap;
    }

    // Generate the HTML template for a student to include all fragments from random servers
    const generateHtmlTemplate = (hostname, fragmentRecords, title) => {
        const fragmentUrls = [];

        // Loop through all of the fragments to build up the template in fragment order
        for (const record of fragmentRecords) {
            // Choose a source for the fragment, preferring other sources than this hostname
            let source = record.assignedTo[0];
            if (record.assignedTo.length > 1) {
                // Filter out the version hosted by this student
                const otherSources = record.assignedTo.filter(
                    hostInfo => hostInfo.hostname !== hostname
                );

                // Pick one of the alternate sources at random
                source = otherSources[Math.floor(Math.random() * otherSources.length)];
            }

            // Add the source and hash for checking that a fragment is correct
            fragmentUrls.push({
                hash: record.hash,
                url: `http://${source.hostname}/${source.fileName}`
            });
        }

        return {
            title,
            fragments: fragmentUrls
        };
    };


    // Assign fragments to students for both hosting and browsing
    const assignFragments = async () => {
        // Create a hosting map for the fragments to the students hosting them with random filenames
        const hostingMap = await createHostingMap(students);
        setHostingMap(hostingMap);

        // Generate HTML templates for all students and set them in state
        const studentTemplates = {};
        for (const { hostname } of students) {
            studentTemplates[hostname] = generateHtmlTemplate(hostname, hostingMap, passage.title);
        }
        setStudentTemplates(studentTemplates);

        // Notify the server of the new assignments
        try {
            await fetch(`/api/www-sim/${sessionId}/assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hostingMap, studentTemplates })
            });

            setAssignmentLocked(true);

            return hostingMap;
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

            {assignmentLocked && (
                <>
                    <h2 className="font-bold" onClick={() => setShowFragments(prev => !prev)}>{showFragments ? "❌" : "🔽"} Fragments</h2>
                    <ul className="list-disc">
                        {showFragments &&
                            fragments.map((fragment, index) => (
                                <li key={index} className="">{fragment}</li>
                            ))}
                    </ul>
                </>
            )}

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
                                onClick={() => setSelectedStudent(s)}
                            />
                        ))
                    }
                </div>
            )}

            {assignmentLocked ?
                selectedStudent && (
                    <StudentInfoPanel hostname={selectedStudent.hostname} template={studentTemplates[selectedStudent.hostname]} hostingMap={hostingMap} />
                ) : (
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
                                    <option key={p.label} value={p}>{p.label + " - " + p.title}</option>
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