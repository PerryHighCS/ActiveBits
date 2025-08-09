import { createSession } from "./sessions.js";

export function setupWwwSimRoutes(app, sessions) {
    // Create a new WWW simulation session
    app.post("/api/www-sim/create", (req, res) => {
        const s = createSession(sessions, { data: {} });
        s.type = "www-sim"; // Set the session type
        res.json({ id: s.id }); // Respond with the new session ID
    });

    // Get a specific WWW simulation session
    app.get("/api/www-sim/:id", (req, res) => {
        const s = sessions[req.params.id];

        // Check if the session exists and is of type 'www-sim'
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        res.json({ id: s.id });
    });

    // Join a WWW simulation session
    app.post("/api/www-sim/:id/join", (req, res) => {
        const s = sessions[req.params.id];
        if (!s || s.type !== "www-sim") {
            return res.status(404).json({ error: "invalid session" });
        }

        let { hostname } = req.body;
        if (!hostname) {
            return res.status(400).json({ error: "hostname required" });
        }
        hostname = hostname.trim().toLowerCase();

        const hostnameRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
        if (!hostnameRegex.test(hostname)) {
            return res.status(400).json({ error: "invalid hostname" });
        }

        // Allow the student to join (or rejoin)
        s.data.students = s.data.students || [];
        const existing = s.data.students.find(student => student.hostname === hostname);
        if (existing) {
            existing.joined = Date.now();
        } else {
            s.data.students.push({ hostname, joined: Date.now() });
        }

        res.json({ message: `Joined session as ${hostname}` });
    });
}
