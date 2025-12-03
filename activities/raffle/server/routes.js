import { createSession } from "../../../server/core/sessions.js";

const raffleSubscribers = new Map(); // raffleId -> Set<WebSocket>

function addSubscriber(raffleId, socket) {
  let set = raffleSubscribers.get(raffleId);
  if (!set) {
    set = new Set();
    raffleSubscribers.set(raffleId, set);
  }
  set.add(socket);
}

function removeSubscriber(raffleId, socket) {
  const set = raffleSubscribers.get(raffleId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) {
    raffleSubscribers.delete(raffleId);
  }
}

function broadcastTicketsUpdate(raffleId, tickets) {
  const set = raffleSubscribers.get(raffleId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ type: "tickets-update", tickets });
  const stale = [];
  for (const socket of set) {
    if (socket.readyState === 1) {
      socket.send(payload);
    } else {
      stale.push(socket);
    }
  }
  stale.forEach(socket => set.delete(socket));
  if (set.size === 0) {
    raffleSubscribers.delete(raffleId);
  }
}

function sendRaffleError(socket, error) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "raffle-error", error }));
  }
}

export default function setupRaffleRoutes(app, sessions, ws) {
  // Create raffle session
  app.post("/api/raffle/create", async (req, res) => {
    const s = await createSession(sessions, { data: {} });

    s.type = "raffle"; // Set the session type
    s.data.tickets = []; // Initialize the ticket store
    
    await sessions.set(s.id, s);

    res.json({ id: s.id }); // Respond with the new session ID
  });

  // Generate a ticket for a raffle
  app.get("/api/raffle/generateTicket/:raffleId", async (req, res) => {
    // Check if the raffle exists and is of type 'raffle'
    const raffle = await sessions.get(req.params.raffleId);
    if (!raffle || raffle.type !== "raffle") {
      console.log(`Request to generate ticket for invalid raffle ${req.params.raffleId}`);
      return res.status(404).json({ error: "invalid raffle" });
    }

    // Create and record a new ticket number
    const ticket = Math.floor(Math.random() * 10000);
    raffle.data.tickets.push(ticket);
    await sessions.set(raffle.id, raffle);

    res.json({ ticket }); // Respond with the new ticket number

    broadcastTicketsUpdate(raffle.id, raffle.data.tickets);
  });

  // List tickets for a raffle
  app.get("/api/raffle/listTickets/:raffleId", async (req, res) => {
    // Check if the raffle exists and is of type 'raffle'
    const raffleId = req.params.raffleId;
    const raffle = await sessions.get(raffleId);
    if (raffle && raffle.type === "raffle") {
      return res.json({ tickets: raffle.data.tickets });
    }

    // If the raffle is invalid, log the request and respond with an error
    console.log(`Request to list tickets for invalid raffle ${raffleId}`);
    res.status(404).json({ error: "invalid raffle" });
  });
  ws.register("/ws/raffle", (socket, qp) => {
    const raffleId = qp.get("raffleId");
    if (!raffleId) {
      socket.close(1008, "Missing raffleId");
      return;
    }

    socket.raffleId = raffleId;
    socket.sessionId = raffleId;
    addSubscriber(raffleId, socket);

    (async () => {
      const raffle = await sessions.get(raffleId);
      if (!raffle || raffle.type !== "raffle") {
        sendRaffleError(socket, "Raffle not found");
        socket.close(1008, "Invalid raffle");
        return;
      }
      socket.send(JSON.stringify({
        type: "tickets-update",
        tickets: raffle.data.tickets || [],
      }));
    })().catch((err) => {
      console.error("Failed to send initial raffle tickets", err);
      sendRaffleError(socket, "Unable to load raffle tickets");
    });

    socket.on("close", () => removeSubscriber(raffleId, socket));
    socket.on("error", () => removeSubscriber(raffleId, socket));
  });
}
