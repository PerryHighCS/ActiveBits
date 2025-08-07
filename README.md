# ActiveBits

**ActiveBits** is a modular, interactive activity server designed for classroom use.  
It currently supports:

- 🎟️ **Raffle Tickets** – Students scan a QR code to receive a unique ticket.
  * Search algorithms can be introduced by hosting a 'raffle', having the class get tickets,
    choosing a winner, then searching for that winner in the list of tickets.
  * Reasonable vs Unreasonable time algorithms can be explored with the pair and group
    raffles, with students trying to find the tickets that add up to the winning total.

- 🌐 **Network Scavenger Hunts** – Simulate IP-based discovery and HTTP interactions.

Future modules will include additional hands-on learning tools for computer science and engineering classrooms.

## Access

Student access: [`https://bits.mycode.run`](https://bits.mycode.run)
Instructor dashboard: [`https://bits.mycode.run/manage`](https://bits.mycode.run/manage)

## For dev
In the main project folder, install dependencies with
```
npm run install-all
```

In the main project folder, start the project with
```
npm run dev
```

## For production
This project can be deployed and hosted by [Render](https://render.com) directly from 
a clone of this repo with the following settings:

Install dependencies and build with
```
npm run deploy
```

Start the server with
```
npm run start
```

