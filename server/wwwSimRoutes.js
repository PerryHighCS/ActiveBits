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
        const assignments = [];

        for (const { fragment, assignedTo } of session.data.fragments || []) {
            for (const { hostname: h, fileName } of assignedTo || []) {
                if (h === hostname) {
                    assignments.push({ fragment, fileName });
                }
            }
        }

        if (assignments.length > 0) {
            const msg = JSON.stringify({
                type: "assigned-fragments",
                payload: { assignments }
            });

            for (const sock of ws.wss.clients) {
                if (
                    sock.readyState === 1 &&
                    sock.sessionId === session.id &&
                    sock.hostname === hostname
                ) {
                    console.log("Sending ", assignments.length, " fragment assignments to", sock.hostname);
                    try { sock.send(msg); } catch { }
                }
            }

            return assignments;
        }
        else {
            console.log("No assignments for ", hostname);
        }
    }

    /////////////////
    // REST endpoints

    // Create a new WWW simulation session
    app.post("/api/www-sim/create", (req, res) => {
        const s = createSession(sessions, { data: { students: [] } });
        s.type = "www-sim"; // Set the session type
        res.json({ id: s.id }); // Respond with the new session ID
    });

    // Get a specific WWW simulation session
    app.get("/api/www-sim/:id", (req, res) => {
        const s = sessions[req.params.id];

        // Check if the session exists and is of type 'www-sim'
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        res.json({ id: s.id, students: s.data.students });
    });

    // Join a WWW simulation session
    app.post("/api/www-sim/:id/join", (req, res) => {
        const s = sessions[req.params.id];
        if (!s || s.type !== "www-sim") {
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
        const existing = s.data.students.find(student => student.hostname === hostname);
        if (existing) {
            existing.joined = now;
        } else {
            s.data.students.push({ hostname, joined: now });
        }

        console.log("Student joined session", s.id, "as", hostname);
        broadcast("student-joined", { hostname, joined: now }, s.id);
        res.json({ message: `Joined session as ${hostname}` });

        // If fragments exist for this student, send them
        sendFragmentAssignments(hostname, s);
    });

    // Edit hostname
    app.patch("/api/www-sim/:id/students/:hostname", (req, res) => {
        const s = sessions[req.params.id];
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const current = req.params.hostname?.trim().toLowerCase();
        const student = s.data.students.find(stu => stu.hostname === current);
        if (!student) return res.status(404).json({ error: "student not found" });

        let { newHostname } = req.body || {};
        if (!newHostname) return res.status(400).json({ error: "new hostname required" });

        newHostname = newHostname.trim().toLowerCase();
        if (!verifyHostname(newHostname)) return res.status(400).json({ error: "invalid hostname" });
        if (newHostname === current) return res.status(200).json({ message: "no change", students: s.data.students });
        if (s.data.students.some(stu => stu.hostname === newHostname)) return res.status(409).json({ error: "hostname already in use" });

        // Update student's hostname
        student.hostname = newHostname;

        // Update hostname on any connected WebSocket
        for (const sock of ws.wss.clients) {
            if (sock.readyState === 1 && sock.sessionId === s.id && sock.hostname === current) {
                sock.hostname = newHostname;
            }
        }

        broadcast("student-updated", { oldHostname: current, newHostname }, s.id);

        console.log("Renamed student ", current, " to ", newHostname);
        res.json({ message: `Updated hostname to ${newHostname}`, students: s.data.students });
    });

    // Remove student
    app.delete("/api/www-sim/:id/students/:hostname", (req, res) => {
        const s = sessions[req.params.id];
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const index = s.data.students.findIndex(stu => stu.hostname === req.params.hostname);
        if (index === -1) return res.status(404).json({ error: "student not found" });

        const removed = s.data.students.splice(index, 1)[0];
        broadcast("student-removed", { hostname: removed.hostname }, s.id);
        res.json({ message: `Removed student ${removed.hostname}`, students: s.data.students });
    });

    // Assign fragments to students
    app.post("/api/www-sim/:id/assign", (req, res) => {
        const s = sessions[req.params.id];
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { assignments } = req.body || {};

        if (!assignments || typeof assignments !== "object") {
            return res.status(400).json({ error: "invalid or missing assignments" });
        }

        // Save to session
        s.data.fragments = assignments;

        // Send assigned fragments to relevant students
        for (const fragment in assignments) {
            for (const { hostname } of assignments[fragment].assignedTo || []) {
                sendFragmentAssignments(hostname, s);
            }
        }

        console.log("Assigned fragments for session", s.id);
        res.json({ message: "Fragments assigned" });
    });

    app.get("/api/www-sim/:id/fragments/:hostname", (req, res) => {
        const s = sessions[req.params.id];
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { hostname } = req.params;
        console.log("Fetching fragments for", hostname, s.id);

        // Find all fragment assignments for this hostname
        const assignments = [];
        for (const frag of s.data.fragments || []) {
            for (const assn of frag.assignedTo || []) {
                if (assn.hostname === hostname) {
                    assignments.push({
                        fileName: assn.fileName,
                        fragment: frag.fragment
                    });
                }
            }
        }

        return res.json({ payload: { assignments } });
    });

}
