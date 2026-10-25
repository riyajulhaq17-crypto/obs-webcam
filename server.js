const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
// Render assigns a dynamic port via process.env.PORT, fallback to 8443 for local testing
const PORT = process.env.PORT || 8443;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/receiver", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "receiver.html"));
});

// Check if local SSL certificates exist
let server;
const keyPath = path.join(__dirname, "key.pem");
const certPath = path.join(__dirname, "cert.pem");

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  // Local development with HTTPS
  server = https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    app
  );
} else {
  // Production (Render) uses standard HTTP because Render handles SSL
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server, path: "/signal" });
const peers = { camera: null, receiver: null };

function send(peer, message) {
  if (peer?.readyState === WebSocket.OPEN) {
    peer.send(JSON.stringify(message));
  }
}

wss.on("connection", (ws, req) => {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const url = new URL(req.url, `${proto}://localhost`);
  const role = url.searchParams.get("role");

  if (!["camera", "receiver"].includes(role)) {
    ws.close(1008, "Invalid role");
    return;
  }

  if (peers[role] && peers[role] !== ws) {
    peers[role].close(1000, "Replaced by a new connection");
  }
  peers[role] = ws;

  send(ws, { type: "status", message: `Connected as ${role}` });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const allowed = [
      "camera-ready",
      "receiver-ready",
      "offer",
      "answer",
      "candidate",
      "stop",
    ];

    if (!allowed.includes(message.type)) return;

    const targetRole = role === "camera" ? "receiver" : "camera";
    send(peers[targetRole], message);
  });

  ws.on("close", () => {
    if (peers[role] === ws) {
      peers[role] = null;
      const targetRole = role === "camera" ? "receiver" : "camera";
      send(peers[targetRole], { type: "peer-disconnected" });
    }
  });

  ws.on("error", (error) => {
    console.error(`${role} WebSocket error:`, error.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
