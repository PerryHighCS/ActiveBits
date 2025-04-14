const express = require("express");
const path = require("path");
const app = express();

// API endpoint example
app.get("/api/generateTicket", (req, res) => {
  res.json({ ticket: Math.floor(Math.random() * 1000) });
});

// Serve static files from the built React app
app.use(express.static(path.join(__dirname, "../client/dist")));

// Fallback route for client-side routing (use "/*" instead of "*")
app.get("/*fallback", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
