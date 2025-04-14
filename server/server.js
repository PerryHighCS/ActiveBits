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
    const deltaT = Date.now() - raffle.created;
    if (deltaT > MAX_RAFFLE_TIME) {
      raffles.delete(raffle);
    }
  }
}

app.get("/api/createRaffle", (req, res) => {
  let raffleNum = null;

  while (!raffleNum || raffles[raffleNum]) {
    raffleNum = (Math.floor(Math.random() * (MAX_RAFFLE))).toString(16).padStart(MAX_ID_LEN, '0')
    ;
  }

  raffles[raffleNum] = {tickets: [], created: Date.now()};

  res.json({ raffleId: raffleNum });

  cleanupRaffles();
});

app.get("/api/generateTicket/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;
  
  if (!raffles[raffleId]) {
    res.status(404).json({ error: "invalid raffle" });
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
  }
});

app.delete("/api/raffle/:raffleId", (req, res) => {
  let raffleId = req.params.raffleId;

  if (raffles[raffleId]) {
    raffles.delete(raffleId);
    res.json({ success: "Deleted " + raffleId });
  }
  else {
    res.status(404).json({ error: 'invalid raffle' });
  }
});

// In production, serve static files from the built frontend.
if (process.env.NODE_ENV === "production") {

  // Serve static files from the built React app
  app.use(express.static(path.join(__dirname, "../client/dist")));

  // Fallback route for client-side routing (use "/*" instead of "*")
  app.get('/*fallback', (req, res) => {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  });

}
else {
  // In development, proxy requests for static files to the Vite dev server.
  const { createProxyMiddleware } = require("http-proxy-middleware");

  // Set up a middleware function to route the paths
  app.use((req, res, next) => {
    // If the path starts with /api, let Express handle it
    if (req.path.startsWith("/api")) {
      return next();
    }

    // Otherwise, use the proxy to send the request to the Vite server
    return createProxyMiddleware({
      target: "http://localhost:5173",
      changeOrigin: true,
      logLevel: "silent" // adjust log level as desired
    })(req, res, next);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Raffle server is running on port ${PORT}`);
});
