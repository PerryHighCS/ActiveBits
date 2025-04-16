const express = require("express");
const path = require("path");
const app = express();

const MAX_ID_LEN = 5;
const MAX_RAFFLE = Math.pow(16, MAX_ID_LEN);  // ids are base 16
const MAX_RAFFLE_TIME = 24 * 60 * 60 * 1000;  // 24 hours

const raffles = {}; // Store raffles in memory

/**
 * Remove any raffles lasting longer than MAX_RAFFLE_TIME
 * This function iterates through the raffles object and deletes any raffle that has exceeded the maximum allowed time.
 * @returns {void}
 */
function cleanupRaffles() {
  for (let raffle in raffles) {
    const deltaT = Date.now() - raffles[raffle].created;
    if (deltaT > MAX_RAFFLE_TIME) {
      delete raffles[raffle];
      console.log(`Deleted expired raffle ${raffle}`);
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
app.get("/api/createRaffle", (req, res) => {
  // Generate a random raffle id
  let raffleNum = null;
  while (!raffleNum || raffles[raffleNum]) {
    raffleNum = (Math.floor(Math.random() * (MAX_RAFFLE))).toString(16).padStart(MAX_ID_LEN, '0');
  }

  // Create the raffle
  raffles[raffleNum] = { id: raffleNum, tickets: [], created: Date.now()};

  res.json({ raffleId: raffleNum });
  console.log(`Created raffle ${raffleNum}`);

  // Clean up any expired raffles
  cleanupRaffles();
});

/**
 * Generate a ticket endpoint
 * This endpoint generates a random ticket number for a specific raffle.
 * It checks if the raffle exists and if the ticket number is unique.
 * If the raffle does not exist, it returns a 404 error with an appropriate message.
 * @param {string} raffleId - The ID of the raffle for which to generate a ticket.
 * @returns {object} - A JSON response containing the generated ticket number or an error message.
 */
app.get("/api/generateTicket/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;
  
  if (!raffles[raffleId]) {
    res.status(404).json({ error: "invalid raffle" });
    console.log(`Request to generate ticket for invalid raffle ${raffleId}`);
    return;
  }

  let ticketNum = null;

  while (!ticketNum || raffles[raffleId].tickets.includes(ticketNum)) {
    ticketNum = 100 + Math.floor(Math.random() * 900);
  }
  raffles[raffleId].tickets.push(ticketNum);

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
app.get("/api/listTickets/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;


  if (raffles[raffleId]) {
    res.json({ tickets: raffles[raffleId].tickets });
  }
  else {
    res.status(404).json({ error: 'invalid raffle' });
    console.log(`Request to list tickets for invalid raffle ${raffleId}`);
  }
});

/**
 * Raffle deletion endpoint
 * This endpoint allows the deletion of a specific raffle by its ID.
 * It checks if the raffle exists, deletes it if it does, and returns a success message.
 * If the raffle does not exist, it returns a 404 error with an appropriate message.
 * The endpoint also cleans up any expired raffles after the deletion.
 * @param {string} raffleId - The ID of the raffle to be deleted.
 * @returns {object} - A JSON response indicating the success of the deletion or an error message.
 */
app.delete("/api/raffle/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;

  if (raffles[raffleId]) {
    // Delete the raffle
    delete raffles[raffleId];
    console.log(`Deleted raffle ${raffleId}`);

    // Clean up any expired raffles
    cleanupRaffles();

    res.json({ success: "Deleted " + raffleId, deleted: raffleId });
  }
  else {
    res.status(404).json({ error: 'invalid raffle' });
  }
});

// In production, serve static files from the built frontend.
if (!process.env.NODE_ENV.startsWith("dev")) {

  // Serve static files from the built React app
  app.use(express.static(path.join(__dirname, "../client/dist")));

  // Fallback route for client-side routing (use "/*" instead of "*")
  app.get('/*fallback', (req, res) => {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  });

}
else {
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

/**
 * Health check endpoint
 * This is used to check if the server is running; it returns a simple JSON response with a status message.
 * @returns {object} - A JSON response indicating the server status.
 */
app.get("/health-check", (req, res) => {
  res.json({ status: "ok" });
});

// Start the server on the port specified by the PORT environment variable if set, otherwise default to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Raffle server is running on port ${PORT}`);
});
