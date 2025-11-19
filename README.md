# ActiveBits

**ActiveBits** is a modular, interactive activity server designed for classroom use.  
It currently supports:

- 🎟️ **Raffle Tickets** – Students scan a QR code to receive a unique ticket.
  * Use raffles to explore search algorithms: run a raffle, assign tickets, choose a winner, and search for that ticket.
  * Use pair and group raffles to highlight the difference between reasonable and unreasonable algorithms (e.g., finding sets that sum to a target).

- 🌐 **Network Scavenger Hunts** – Simulate IP-based discovery and HTTP interactions.

- ☕ **Java String Practice** – Interactive practice for Java String methods including `substring()`, `indexOf()`, `equals()`, `length()`, and `compareTo()`.
  * Real-time teacher control of which methods students practice
  * Live student progress tracking with sortable statistics
  * Solo mode for self-paced learning
  * Downloadable CSV reports for classroom assessment

Future modules will include additional hands-on learning tools for computer science and engineering classrooms.

## 📚 Documentation

- **[Adding Activities](ADDING_ACTIVITIES.md)** - Start here! Complete tutorial with working code examples
- **[Architecture Guide](ARCHITECTURE.md)** - Deep dive into codebase structure, patterns, and design decisions

---

## 🌐 Access

- **Student site:** [`https://bits.mycode.run`](https://bits.mycode.run)  
- **Instructor dashboard:** [`https://bits.mycode.run/manage`](https://bits.mycode.run/manage)

---

## 🛠️ Development

From the project root:

Install dependencies:
```bash
npm run install-all
```

Start the dev server:
```bash
npm run dev
```

> ⚠️ **Important:** Connect to the **Express server on port 3000**, _not_ the Vite port (5173). Codespaces may automatically open the wrong one.

---

## 🚀 Production (via Render)

This project can be deployed directly on [Render](https://render.com) as a Web Service with the following settings:

Build Command _(to install dependencies and build before each deployment)_:
```bash
npm run deploy
```

Start Command _(to start the server itself)_:
```bash
npm run start
```
