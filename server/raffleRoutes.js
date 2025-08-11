import { createSession } from "./sessions.js";

export default function setupRaffleRoutes(app, sessions, ws) {
  // Create raffle session
  app.post("/api/raffle/create", (req, res) => {
    const s = createSession(sessions, { data: {} });

    s.type = "raffle"; // Set the session type
    s.data.tickets = []; // Initialize the ticket store

    res.json({ id: s.id }); // Respond with the new session ID
  });

  // Generate a ticket for a raffle
  app.get("/api/raffle/generateTicket/:raffleId", (req, res) => {
    // Check if the raffle exists and is of type 'raffle'
    const raffle = sessions[req.params.raffleId];
    if (!raffle || raffle.type !== "raffle") {
      console.log(`Request to generate ticket for invalid raffle ${req.params.raffleId}`);
      return res.status(404).json({ error: "invalid raffle" });
    }

    // Create and record a new ticket number
    const ticket = Math.floor(Math.random() * 10000);
    raffle.data.tickets.push(ticket);

    res.json({ ticket }); // Respond with the new ticket number
  });

  // List tickets for a raffle
  app.get("/api/raffle/listTickets/:raffleId", (req, res) => {
    // Check if the raffle exists and is of type 'raffle'
    const raffleId = req.params.raffleId;
    const raffle = sessions[raffleId];
    if (raffle && raffle.type === "raffle") {
      return res.json({ tickets: raffle.data.tickets });
    }

    // If the raffle is invalid, log the request and respond with an error
    console.log(`Request to list tickets for invalid raffle ${raffleId}`);
    res.status(404).json({ error: "invalid raffle" });
  });
}