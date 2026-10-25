const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const PORT = 8443;

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/receiver", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "receiver.html"));
});

// const server = https.createServer(
//   {
//     key: fs.readFileSync(path.join(__dirname, "key.pem")),
//     cert: fs.readFileSync(path.join(__dirname, "cert.pem")),
//   },
//   app
// );

const wss = new WebSocketServer({ server, path: "/signal" });
const peers = { camera: null, receiver: null };

function send(peer, message) {
  if (peer?.readyState === WebSocket.OPEN) {
    peer.send(JSON.stringify(message));
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "https://localhost");
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
  console.log(`Phone camera: https://localhost:${PORT}/`);
  console.log(`OBS receiver: https://localhost:${PORT}/receiver`);
  console.log("Use your computer's LAN IP on your phone.");
});
