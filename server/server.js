const express = require("express");
const path = require("path");
const app = express();

const MAX_ID_LEN = 5;
const MAX_RAFFLE = Math.pow(16, MAX_ID_LEN); // Use ids in base 16
const MAX_RAFFLE_TIME = 24 * 60 * 60 * 1000;  // 24 hours

const raffles = {};

/**
 * Remove any raffles lasting longer than MAX_RAFFLE_TIME
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Raffle server is running on port ${PORT}`);
});
