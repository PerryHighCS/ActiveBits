import crypto from "crypto";
import { createSession } from "activebits-server/core/sessions.js";
import { createBroadcastSubscriptionHelper } from "activebits-server/core/broadcastUtils.js";
import { registerSessionNormalizer } from "activebits-server/core/sessionNormalization.js";
import presetPassages from "./presetPassages.js";

registerSessionNormalizer("www-sim", (session) => {
    const data = session.data;
    data.students = Array.isArray(data.students) ? data.students : [];
    const templates = data.studentTemplates;
    data.studentTemplates =
        templates && typeof templates === "object" && !Array.isArray(templates) ? templates : {};
    data.fragments = Array.isArray(data.fragments) ? data.fragments : [];
});

export default function setupWwwSimRoutes(app, sessions, ws) {
    const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws);
    // WS namespace
    ws.register("/ws/www-sim", (socket, qp) => {
        socket.sessionId = qp.get("sessionId") || null;
        ensureBroadcastSubscription(socket.sessionId);
        socket.hostname = qp.get("hostname")?.trim().toLowerCase() || null;
    });

    // Broadcast helper
    async function broadcast(type, payload, sessionId) {
        const msg = JSON.stringify({ type, payload });
        if (sessions.publishBroadcast) {
            await sessions.publishBroadcast(`session:${sessionId}:broadcast`, { type, payload });
        }
        // Local broadcast to WebSocket clients
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

    function dividePassage(passage, parts = 5) {
        const words = passage.split(/\s+/);
        const size = Math.ceil(words.length / parts);
        const fragments = [];
        for (let i = 0; i < parts; i++) {
            fragments.push(words.slice(i * size, (i + 1) * size).join(" "));
        }
        return fragments;
    }

    function getRandomName(passage) {
        const adjectives = passage?.adjectives || ["strange", "bright", "quick"];
        const nouns = passage?.nouns || ["thing", "signal", "object"];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj}-${noun}`;
    }

    function getRandomUnusedName(used, passage) {
        let n;
        do {
            n = getRandomName(passage);
        } while (used.includes(n));
        return n;
    }

    function createHash(fragment) {
        return crypto.createHash("sha256").update(fragment).digest("hex");
    }

    function createHostingMap(students, passage) {
        const fragments = dividePassage(passage.value);
        const studentHostingMap = {};
        const fragmentHostingMap = [];

        for (const s of students) {
            studentHostingMap[s.hostname] = [];
        }

        fragments.forEach((fragment, index) => {
            const fragmentRecord = { fragment, index: Number(index), assignedTo: [], hash: createHash(fragment) };

            const student = students[Math.floor(Math.random() * students.length)];
            const fileName = getRandomUnusedName(studentHostingMap[student.hostname], passage);

            studentHostingMap[student.hostname].push(fileName);
            fragmentRecord.assignedTo.push({ hostname: student.hostname, fileName });
            fragmentHostingMap.push(fragmentRecord);
        });

        for (const student of students) {
            const { hostname } = student;
            while (studentHostingMap[hostname].length < 3) {
                const randomFragmentIndex = Math.floor(Math.random() * fragments.length);
                if (fragmentHostingMap[randomFragmentIndex].assignedTo.some(a => a.hostname === hostname)) continue;
                const fileName = getRandomUnusedName(studentHostingMap[hostname], passage);
                studentHostingMap[hostname].push(fileName);
                fragmentHostingMap[randomFragmentIndex].assignedTo.push({ hostname, fileName });
            }
        }

        return fragmentHostingMap;
    }

    function generateHtmlTemplate(hostname, fragmentRecords, title) {
        const fragmentUrls = [];
        for (const record of fragmentRecords) {
            let source = record.assignedTo[0];
            if (record.assignedTo.length > 1) {
                const other = record.assignedTo.filter(h => h.hostname !== hostname);
                source = other[Math.floor(Math.random() * other.length)] || source;
            }
            fragmentUrls.push({ hash: record.hash, url: `http://${source.hostname}/${source.fileName}` });
        }
        return { title, fragments: fragmentUrls };
    }

    // Send fragments assigned to a specific hostname
    async function sendFragmentAssignments(hostname, session) {
        const hostFragments = [];

        for (const { fragment, assignedTo } of session.data.fragments || []) {
            for (const { hostname: h, fileName } of assignedTo || []) {
                if (h === hostname) {
                    hostFragments.push({ fragment, fileName });
                }
            }
        }

        let requests = session.data.studentTemplates[hostname];
        if (!requests && session.data.fragments && session.data.fragments.length > 0) {
            requests = generateHtmlTemplate(hostname, session.data.fragments, session.data.passage?.title);
            session.data.studentTemplates[hostname] = requests;
            await sessions.set(session.id, session);
            await broadcast("template-assigned", { hostname, template: requests }, session.id);
        }

        if (hostFragments.length > 0 || requests) {
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

    // Get preset passages
    app.get("/api/www-sim/passages", (req, res) => {
        res.json(presetPassages);
    });

    // Create a new WWW simulation session
    app.post("/api/www-sim/create", async (req, res) => {
        const session = await createSession(sessions, { data: { students: [], studentTemplates: {} } });
        session.type = "www-sim"; // Set the session type
        await sessions.set(session.id, session);
        ensureBroadcastSubscription(session.id);
        res.json({ id: session.id }); // Respond with the new session ID
    });

    // Get a specific WWW simulation session
    app.get("/api/www-sim/:id", async (req, res) => {
        const session = await sessions.get(req.params.id);

        // Check if the session exists and is of type 'www-sim'
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        res.json({ id: session.id, students: session.data.students, studentTemplates: session.data.studentTemplates || [], hostingMap: session.data.fragments || [], passage: session.data.passage });
    });

    // Join a WWW simulation session
    app.post("/api/www-sim/:id/join", async (req, res) => {
        const session = await sessions.get(req.params.id);
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

        await sessions.set(session.id, session);
        console.log("Student joined session", session.id, "as", hostname);
        await broadcast("student-joined", { hostname, joined: now }, session.id);
        res.json({ message: `Joined session as ${hostname}` });

        // If fragments exist for this student, send them
        await sendFragmentAssignments(hostname, session);
    });

    // Edit hostname
    app.patch("/api/www-sim/:id/students/:hostname", async (req, res) => {
        const session = await sessions.get(req.params.id);
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

        await sessions.set(session.id, session);
        await broadcast("student-updated", { oldHostname: current, newHostname }, session.id);

        console.log("Renamed student ", current, " to ", newHostname);
        res.json({ message: `Updated hostname to ${newHostname}`, students: session.data.students });
    });

    // Remove student
    app.delete("/api/www-sim/:id/students/:hostname", async (req, res) => {
        const session = await sessions.get(req.params.id);
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const index = session.data.students.findIndex(stu => stu.hostname === req.params.hostname);
        if (index === -1) return res.status(404).json({ error: "student not found" });

        const removed = session.data.students.splice(index, 1)[0];
        await sessions.set(session.id, session);
        await broadcast("student-removed", { hostname: removed.hostname }, session.id);
        res.json({ message: `Removed student ${removed.hostname}`, students: session.data.students });
    });

    // Assign fragments for students to host and HTML templates for them to fill
    app.post("/api/www-sim/:id/assign", async (req, res) => {
        const session = await sessions.get(req.params.id);
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { passage } = req.body || {};
        if (!passage || typeof passage !== "object" || typeof passage.value !== "string") {
            return res.status(400).json({ error: "invalid or missing passage" });
        }
        if (
            Array.isArray(session.data.fragments) &&
            session.data.fragments.length > 0 &&
            session.data.studentTemplates &&
            Object.keys(session.data.studentTemplates).length > 0
        ) {
            return res.status(409).json({ error: "hosting map and templates already assigned" });
        }

        const hostingMap = createHostingMap(session.data.students, passage);
        const studentTemplates = {};
        for (const { hostname } of session.data.students) {
            studentTemplates[hostname] = generateHtmlTemplate(hostname, hostingMap, passage.title);
        }

        session.data.fragments = hostingMap;
        session.data.studentTemplates = studentTemplates;
        session.data.passage = passage;

        await sessions.set(session.id, session);
        await broadcast("fragments-assigned", { studentTemplates, hostingMap }, session.id);

        for (const frag of hostingMap) {
            for (const { hostname } of frag.assignedTo || []) {
                await sendFragmentAssignments(hostname, session);
            }
        }

        console.log("Assigned fragments for session", session.id);
        res.json({ message: "Fragments assigned" });
    });

    app.put("/api/www-sim/:id/assign", async (req, res) => {

        const session = await sessions.get(req.params.id);
        if (!session || session.type !== "www-sim") return res.status(404).json({ error: "invalid session" });

        const { hostname, template } = req.body || {};
        if (!hostname || !template) return res.status(400).json({ error: "hostname and template required" });

        if (session.data.studentTemplates[hostname]) return res.status(409).json({ error: "template already assigned to this hostname" });

        session.data.studentTemplates ??= {};
        session.data.studentTemplates[hostname] = template;

        await sessions.set(session.id, session);
        await broadcast("template-assigned", { hostname, template }, session.id);

        console.log("Template only assigned to", hostname);
        res.json({ message: "Template assigned" });
    });


    // Get fragments for a specific student
    app.get("/api/www-sim/:id/fragments/:hostname", async (req, res) => {
        const session = await sessions.get(req.params.id);
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
