const express = require("express");
const path = require("path");
const app = express();

const MAX_ID_LEN = 5;
const MAX_RAFFLE = Math.pow(16, MAX_ID_LEN);  // ids are base 16
const MAX_RAFFLE_TIME = 24 * 60 * 60 * 1000;  // 24 hours

const sessions = {}; // Store sessions in memory

/**
 * Remove any raffles lasting longer than MAX_RAFFLE_TIME
 * This function iterates through the raffles object and deletes any raffle that has exceeded the maximum allowed time.
 * @returns {void}
 */
function cleanupSessions() {
  for (let session in sessions) {
    const deltaT = Date.now() - sessions[session].created;
    if (deltaT > MAX_RAFFLE_TIME) {
      delete sessions[session];
      console.log(`Deleted expired session ${session}`);
    }
  }
}

/**
 * Raffle creation endpoint
 * This endpoint creates a new raffle with a unique ID.
 * It generates a random raffle ID and stores it in the raffles object.
 * It also cleans up any expired raffles after creating a new one.
 * @returns {object} - A JSON response containing the raffle ID.
 */
app.get("/api/raffle/createRaffle", (req, res) => {
  // Generate a random raffle id
  let raffleNum = null;
  while (!raffleNum || sessions[raffleNum]) {
    raffleNum = (Math.floor(Math.random() * (MAX_RAFFLE))).toString(16).padStart(MAX_ID_LEN, '0');
  }

  // Create the raffle
  sessions[raffleNum] = { type: 'raffle', id: raffleNum, tickets: [], created: Date.now()};

  res.json({ raffleId: raffleNum });
  console.log(`Created raffle session ${raffleNum}`);

  // Clean up any expired raffles
  cleanupSessions();
});

/**
 * Generate a ticket endpoint
 * This endpoint generates a random ticket number for a specific raffle.
 * It checks if the raffle exists and if the ticket number is unique.
 * If the raffle does not exist, it returns a 404 error with an appropriate message.
 * @param {string} raffleId - The ID of the raffle for which to generate a ticket.
 * @returns {object} - A JSON response containing the generated ticket number or an error message.
 */
app.get("/api/raffle/generateTicket/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;
  
  if (!sessions[raffleId] || sessions[raffleId].type !== 'raffle') {
    res.status(404).json({ error: "invalid raffle" });
    console.log(`Request to generate ticket for invalid raffle ${raffleId}`);
    return;
  }

  let ticketNum = null;

  while (!ticketNum || sessions[raffleId].tickets.includes(ticketNum)) {
    ticketNum = 100 + Math.floor(Math.random() * 900);
  }
  sessions[raffleId].tickets.push(ticketNum);

  res.json({ ticket: ticketNum });
});

/**
 * List tickets endpoint
 * This endpoint retrieves the list of tickets for a specific raffle.
 * It checks if the raffle exists, and if it does, it returns the list of tickets.
 * If the raffle does not exist, it returns a 404 error with an appropriate message.
 * @param {string} raffleId - The ID of the raffle for which to list tickets.
 * @returns {object} - A JSON response containing the list of tickets or an error message.
 */
app.get("/api/raffle/listTickets/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;

  if (sessions[raffleId] && sessions[raffleId].type === 'raffle') {
    res.json({ tickets: sessions[raffleId].tickets });
  }
  else {
    res.status(404).json({ error: 'invalid raffle' });
    console.log(`Request to list tickets for invalid raffle ${raffleId}`);
  }
});

/**
 * Session deletion endpoint
 * This endpoint allows the deletion of a specific session by its ID.
 * It checks if the session exists, deletes it if it does, and returns a success message.
 * If the session does not exist, it returns a 404 error with an appropriate message.
 * The endpoint also cleans up any expired sessions after the deletion.
 * @param {string} sessionId - The ID of the session to be deleted.
 * @returns {object} - A JSON response indicating the success of the deletion or an error message.
 */
app.delete("/api/session/:sessionId", (req, res) => {
  let sessionId = req.params.sessionId;

  if (sessions[sessionId]) {
    // Delete the raffle
    delete sessions[sessionId];
    console.log(`Deleted session ${sessionId}`);

    // Clean up any expired raffles
    cleanupSessions();

    res.json({ success: "Deleted " + sessionId, deleted: sessionId });
  }
  else {
    res.status(404).json({ error: 'invalid session' });
  }
});

/**
 * Health check endpoint
 * This is used to check if the server is running; it returns a simple JSON response with a status message.
 * @returns {object} - A JSON response indicating the server status.
 */
app.get("/health-check", (req, res) => {
  res.json({ status: "ok", memory: process.memoryUsage() });
});

// In production, serve static files from the built frontend.
if (!process.env.NODE_ENV.startsWith("dev")) {

  // Serve static files for the built React app
  app.use(express.static(path.join(__dirname, "../client/dist")));

  // Fallback route for client-side routing
  app.get('/*fallback', (req, res) => {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  });

}
else {
  // Show trace warnings in development
  process.on('warning', e => console.warn(e.stack));

  // In development, proxy requests for static files to the Vite dev server.
  const { createProxyMiddleware } = require("http-proxy-middleware");
  const viteProxy = createProxyMiddleware({
    target: "http://localhost:5173",
    changeOrigin: true,
    logLevel: "silent" // adjust log level as desired
  })

  // Set up a middleware function to route the paths
  app.use((req, res, next) => {
    // If the path starts with /api, let Express handle it
    if (req.path.startsWith("/api")) {
      return next();
    }

    // Otherwise, use the proxy to send the request to the Vite server
    return viteProxy(req, res, next);
  });
}

// Start the server on the port specified by the PORT environment variable if set, otherwise default to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {  
  console.log(`ActiveBits server is running on port [1m[32mhttp://localhost:${PORT}[0m`);
});
