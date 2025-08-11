import { createSession } from "./sessions.js";

export default function setupWwwSimRoutes(app, sessions, ws) {
    // WS namespace
    ws.register("/ws/www-sim", (socket, qp) => {
        socket.sessionId = qp.get("sessionId") || null;
        socket.hostname = qp.get("hostname")?.trim().toLowerCase() || null;
    });

    // Broadcast helper
    function broadcast(type, payload, sessionId) {
        const msg = JSON.stringify({ type, payload });
        for (const s of ws.wss.clients) {
            if (s.readyState === 1 && s.sessionId === sessionId) {
                try { s.send(msg); } catch { }
            }
        }
    }

    function verifyHostname(hostname) {
        const hostnameRegex = /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
        return hostnameRegex.test(hostname.trim().toLowerCase());
    }

    // Send fragments assigned to a specific hostname
    function sendFragmentAssignments(hostname, session) {
        const hostFragments = [];

        for (const { fragment, assignedTo } of session.data.fragments || []) {
            for (const { hostname: h, fileName } of assignedTo || []) {
                if (h === hostname) {
                    hostFragments.push({ fragment, fileName });
                }
            }
        }

        const requests = session.data.studentTemplates[hostname] || {};

        if (hostFragments.length > 0) {
            const msg = JSON.stringify({
                type: "assigned-fragments",
                payload: { host: hostFragments, requests }
            });

            for (const sock of ws.wss.clients) {
                if (
                    sock.readyState === 1 &&
                    sock.sessionId === session.id &&
                    sock.hostname === hostname
                ) {
                    console.log("Sending ", hostFragments.length, " fragment assignments to", sock.hostname);
                    try { sock.send(msg); } catch { }
                }
            }

            return hostFragments;
        }
        else {
            console.log("No assignments for ", hostname);
        }
    }

    /////////////////
    // REST endpoints

    // Create a new WWW simulation session
    app.post("/api/www-sim/create", (req, res) => {
        const session = createSession(sessions, { data: { students: [], studentTemplates: {} } });
        session.type = "www-sim"; // Set the session type
        res.json({ id: session.id }); // Respond with the new session ID
    });

    // Get a specific WWW simulation session
    app.get("/api/www-sim/:id", (req, res) => {
        const session = sessions[req.params.id];

        // Check if the session exists and is of type 'www-sim'
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        res.json({ id: session.id, students: session.data.students, studentTemplates: session.data.studentTemplates || [], hostingMap: session.data.fragments || [] });
    });

    // Join a WWW simulation session
    app.post("/api/www-sim/:id/join", (req, res) => {
        const session = sessions[req.params.id];
        if (!session || session.type !== "www-sim") {
            return res.status(404).json({ error: "invalid session" });
        }

        let { hostname } = req.body || {};
        if (!hostname) {
            return res.status(400).json({ error: "hostname required" });
        }
        hostname = hostname.trim().toLowerCase();
        if (!verifyHostname(hostname)) {
            return res.status(400).json({ error: "invalid hostname" });
        }

        const now = Date.now();
        // Allow the student to join (or rejoin)
        const existing = session.data.students.find(student => student.hostname === hostname);
        if (existing) {
            existing.joined = now;
        } else {
            session.data.students.push({ hostname, joined: now });
        }

        console.log("Student joined session", session.id, "as", hostname);
        broadcast("student-joined", { hostname, joined: now }, session.id);
        res.json({ message: `Joined session as ${hostname}` });

        // If fragments exist for this student, send them
        sendFragmentAssignments(hostname, session);
    });

    // Edit hostname
    app.patch("/api/www-sim/:id/students/:hostname", (req, res) => {
        const session = sessions[req.params.id];
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const current = req.params.hostname?.trim().toLowerCase();
        const student = session.data.students.find(stu => stu.hostname === current);
        if (!student) return res.status(404).json({ error: "student not found" });

        let { newHostname } = req.body || {};
        if (!newHostname) return res.status(400).json({ error: "new hostname required" });

        newHostname = newHostname.trim().toLowerCase();
        if (!verifyHostname(newHostname)) return res.status(400).json({ error: "invalid hostname" });
        if (newHostname === current) return res.status(200).json({ message: "no change", students: session.data.students });
        if (session.data.students.some(stu => stu.hostname === newHostname)) return res.status(409).json({ error: "hostname already in use" });

        // Update student's hostname
        student.hostname = newHostname;

        // Update hostname on any connected WebSocket
        for (const sock of ws.wss.clients) {
            if (sock.readyState === 1 && sock.sessionId === session.id && sock.hostname === current) {
                sock.hostname = newHostname;
            }
        }

        // Update all templates with embedded references to old hostname
        const templates = session.data.studentTemplates || {};
        const updatedTemplates = {};

        const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`//${escaped}/`, "g");

        for (const [host, template] of Object.entries(templates)) {
            const rewritten = {
                ...template,
                fragments: (template.fragments || []).map(frag => ({
                    ...frag,
                    url: frag.url?.replace(regex, `//${newHostname}/`)
                }))
            };
            // Also rename the key if this was the student's own template
            const key = (host === current) ? newHostname : host;
            updatedTemplates[key] = rewritten;
        }

        session.data.studentTemplates = updatedTemplates;

        // Update fragment assignments
        for (const frag of session.data.fragments || []) {
            if (Array.isArray(frag.assignedTo)) {
                for (const assn of frag.assignedTo) {
                    if (assn.hostname === current) {
                        assn.hostname = newHostname;
                        console.log("Updated fragment assignment for", current, "->", assn.hostname, assn);
                    }
                }
            }
        }

        broadcast("student-updated", { oldHostname: current, newHostname }, session.id);

        console.log("Renamed student ", current, " to ", newHostname);
        res.json({ message: `Updated hostname to ${newHostname}`, students: session.data.students });
    });

    // Remove student
    app.delete("/api/www-sim/:id/students/:hostname", (req, res) => {
        const session = sessions[req.params.id];
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const index = session.data.students.findIndex(stu => stu.hostname === req.params.hostname);
        if (index === -1) return res.status(404).json({ error: "student not found" });

        const removed = session.data.students.splice(index, 1)[0];
        broadcast("student-removed", { hostname: removed.hostname }, session.id);
        res.json({ message: `Removed student ${removed.hostname}`, students: session.data.students });
    });

    // Assign fragments for students to host and HTML templates for them to fill
    app.post("/api/www-sim/:id/assign", (req, res) => {
        const session = sessions[req.params.id];
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { hostingMap, studentTemplates } = req.body || {};

        if (!hostingMap || typeof hostingMap !== "object") {
            return res.status(400).json({ error: "invalid or missing hosting map" });
        }
        if (!studentTemplates || typeof studentTemplates !== "object") {
            return res.status(400).json({ error: "invalid or missing student templates" });
        }
        if (session.data.fragments && session.data.length > 0 &&
            session.data.studentTemplates && Object.keys(session.data.studentTemplates).length > 0) {
            return res.status(409).json({ error: "hosting map and templates already assigned" });
        }

        // Save to session
        session.data.fragments = hostingMap;
        session.data.studentTemplates = studentTemplates;

        broadcast("fragments-assigned", {
            studentTemplates: session.data.studentTemplates,
            hostingMap: session.data.fragments
        },
            session.id
        );

        // Send assigned fragments to relevant students
        for (const fragment in hostingMap) {
            for (const { hostname } of hostingMap[fragment].assignedTo || []) {
                sendFragmentAssignments(hostname, session);
            }
        }

        console.log("Assigned fragments for session", session.id);
        res.json({ message: "Fragments assigned" });
    });

    app.put("/api/www-sim/:id/assign", (req, res) => {

        const session = sessions[req.params.id];
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { hostname, template } = req.body || {};
        if (!hostname || !template) return res.status(400).json({ error: "hostname and template required" });

        if (session.data.studentTemplates[hostname]) return res.status(409).json({ error: "template already assigned to this hostname" });

        session.data.studentTemplates ??= {};
        session.data.studentTemplates[hostname] = template;

        broadcast("template-assigned", { hostname, template }, session.id);

        console.log("Template only assigned to", hostname);
        res.json({ message: "Template assigned" });
    });


    // Get fragments for a specific student
    app.get("/api/www-sim/:id/fragments/:hostname", (req, res) => {
        const session = sessions[req.params.id];
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { hostname } = req.params;
        console.log("Fetching fragments for", hostname, session.id);

        // Find all fragment assignments for this hostname
        const host = [];
        for (const frag of session.data.fragments || []) {
            for (const assn of frag.assignedTo || []) {
                if (assn.hostname === hostname) {
                    host.push({
                        fileName: assn.fileName,
                        fragment: frag.fragment
                    });
                }
            }
        }

        return res.json({ payload: { host, requests: session.data.studentTemplates[hostname] } });
    });

}
