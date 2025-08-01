const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

const server = app.listen(3000, () => console.log("🔥 FireZap rodando na porta 3000"));
const wss = new WebSocket.Server({ server });

const sessions = {};

async function startSession(sessionId) {
  const sessionPath = path.join(__dirname, "sessions", sessionId);
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: state });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update;
    if (qr) sessions[sessionId].qr = qr;
    sessions[sessionId].connected = connection === "open";

    // envia para todos os clientes conectados via WebSocket
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ sessionId, qr, connected: sessions[sessionId].connected }));
      }
    });

    if (connection === "close") {
      console.log(`⚠️ Sessão ${sessionId} caiu, tentando reconectar...`);
      setTimeout(() => startSession(sessionId), 3000);
    }
  });

  sessions[sessionId] = { sock, connected: false, qr: null };
}

app.post("/session", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Informe sessionId" });

  if (!sessions[sessionId]) await startSession(sessionId);
  res.json({ sessionId, qr: sessions[sessionId].qr, connected: sessions[sessionId].connected });
});

app.post("/send", async (req, res) => {
  const { sessionId, number, message } = req.body;
  if (!sessions[sessionId]?.sock) return res.status(400).json({ error: "Sessão não encontrada" });

  await sessions[sessionId].sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
  res.json({ success: true });
});

app.use(express.static("public"));
