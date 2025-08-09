import { createSession } from "./sessions.js";

export default function setupWwwSimRoutes(app, sessions, ws) {
    // WS namespace
    ws.register("/ws/www-sim", (socket, qp) => {
        socket.sessionId = qp.get("sessionId") || null;
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

        student.hostname = newHostname;
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
}
