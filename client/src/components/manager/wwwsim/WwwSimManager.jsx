import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Button from "@src/components/ui/Button";
import RosterPill from "@src/components/ui/RosterPill";
import StudentInfoPanel from "../../ui/StudentInfoPanel";

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
    const [presetPassages, setPresetPassages] = useState([]);
    const [passage, setPassage] = useState(null);
    const [passageEdit, setPassageEdit] = useState(false);
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

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/www-sim/passages", { credentials: "include" });
                if (!res.ok) throw new Error("failed to load passages");
                const data = await res.json();
                if (!cancelled) {
                    setPresetPassages(data);
                    setPassage(p => p || data[0]);
                }
            } catch (e) {
                console.error(e);
            }
        })();
        return () => { cancelled = true; };
    }, []);

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
                    if (session.passage) setPassage(session.passage);

                    if (session.hostingMap && session.hostingMap.length > 0 &&
                        session.studentTemplates && Object.keys(session.studentTemplates).length > 0) {
                        setHostingMap(session.hostingMap || []);
                        setStudentTemplates(session.studentTemplates || []);
                        setFragments(session.hostingMap.map(f => f.fragment));
                        setAssignmentLocked(true);
                    }

                    hostingMapRef.current = session.hostingMap || {};
                    studentTemplatesRef.current = session.studentTemplates || {};
                    studentsRef.current = session.students || [];

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
        return () => { try { ws.close(); } catch { console.error("Error closing WebSocket"); } };
    }, [displayCode, selectedStudent?.hostname]);

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
        } catch { 
            console.error("Failed to copy link");
        }
    }

    // Assign fragments to students by requesting server to generate hosting map and templates
    const assignFragments = async () => {
        try {
            await fetch(`/api/www-sim/${sessionId}/assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ passage })
            });

            setAssignmentLocked(true);
        } catch (e) {
            console.error("Failed to assign fragments", e);
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
                            <label htmlFor="preset" className="font-semibold">Choose a passage:</label>
                            <select
                                id="preset"
                                className="border border-gray-300 rounded px-2 py-2 w-full max-w-md ml-2"
                                onChange={(e) => {
                                    const selected = presetPassages.find(p => p.label === e.target.value);
                                    if (selected) setPassage(selected);
                                }}
                                value={passage?.label || ""}
                            >
                                {presetPassages.map(p => (
                                    <option key={p.label} value={p.label}>{p.label + " - " + p.title}</option>
                                ))}
                            </select>
                            <Button className="ml-2" onClick={() => setPassageEdit(v => !v)}>
                                {passageEdit ? "Hide" : "View/Edit"}
                            </Button>
                        </div>

                        {passageEdit && (
                            <div className="transition-all duration-200 ease-in-out">
                                <textarea
                                    className="w-full h-32 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                                    placeholder="Enter your own passage here..."
                                    value={passage?.value || ""}
                                    onChange={(e) => setPassage(prev => ({ ...prev, value: e.target.value }))}
                                />
                            </div>
                        )}


                        <div className="pt-4">
                            <Button onClick={assignFragments} disabled={students.length === 0 || !passage}>
                                Assign Fragments
                            </Button>
                        </div>
                    </div>
                )}
        </div>
    );
}