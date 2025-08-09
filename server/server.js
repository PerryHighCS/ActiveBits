import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createSessionStore, setupSessionRoutes } from "./sessions.js"; // ↔ _sessions.js below
import { setupRaffleRoutes } from "./raffleRoutes.js";
import { setupWwwSimRoutes } from "./wwwSimRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // Parse JSON request bodies

// In-memory store shared by all session types
const sessions = createSessionStore();
app.locals.sessions = sessions;

// Attach generic session routes first
setupSessionRoutes(app, sessions);

// Attach feature-specific route handlers
setupRaffleRoutes(app, sessions);
setupWwwSimRoutes(app, sessions);

// Health check
app.get("/health-check", (req, res) => {
    res.json({ status: "ok", memory: process.memoryUsage() });
});

// Static files / Vite proxy
const env = process.env.NODE_ENV || "development";
if (!env.startsWith("dev")) {
    // In production mode, serve static files from the React build directory
    app.use(express.static(path.join(__dirname, "../client/dist")));

    // All other requests should simply serve the React app
    app.get("/*", (req, res) => {
        res.sendFile(path.join(__dirname, "../client/dist/index.html"));
    });
} else {
    // Development mode: proxy requests to Vite
    process.on("warning", e => console.warn(e.stack));
    const { createProxyMiddleware } = await import("http-proxy-middleware");
    const viteProxy = createProxyMiddleware({
        target: "http://localhost:5173",
        changeOrigin: true,
        logLevel: "silent",
    });
    app.use((req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        return viteProxy(req, res, next);
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ActiveBits server running on \x1b[1m\x1b[32mhttp://localhost:${PORT}\x1b[0m`);
});