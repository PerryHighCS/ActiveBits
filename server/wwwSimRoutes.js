export function setupWwwSimRoutes(app, sessions) {
    // Create a new WWW simulation session
    app.post("/api/sessions", (req, res) => {
        const s = createSession(sessions, { data: {} });
        s.type = "www-sim"; // Set the session type
        res.json({ id: s.id }); // Respond with the new session ID
    });

    // Get a specific WWW simulation session
    app.get("/api/sessions/:id", (req, res) => {
        const s = sessions[req.params.id];

        // Check if the session exists and is of type 'www-sim'
        if (!s || s.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        res.json({ id: s.id });
    });
}
