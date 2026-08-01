import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SECRET = process.env.BRIDGE_SECRET || "";
const queue = [];
const sseClients = new Map();

const ISSUER = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : "https://svakom-ble-ai-production-03c6.up.railway.app";

function auth(req, res, next) {
  const s = req.headers["x-bridge-secret"] || req.query.secret || "";
  if (SECRET && s !== SECRET) return res.status(403).json({ error: "forbidden" });
  next();
}

app.get("/toy-next", auth, (req, res) => {
  const cmd = queue.shift();
  res.json(cmd || {});
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"]
  });
});

app.post("/oauth/register", (req, res) => {
  const clientId = randomUUID();
  res.json({
    client_id: clientId,
    client_secret: "none",
    redirect_uris: req.body.redirect_uris || [],
    grant_types: ["authorization_code"],
    response_types: ["code"]
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge } = req.query;
  const code = randomUUID();
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.post("/oauth/token", (req, res) => {
  res.json({
    access_token: randomUUID(),
    token_type: "bearer",
    expires_in: 86400
  });
});

app.get("/mcp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const sessionId = randomUUID();
  sseClients.set(sessionId, res);
  res.write(`event: endpoint\ndata: ${JSON.stringify({ uri: `/mcp/message?sessionId=${sessionId}` })}\n\n`);
  req.on("close", () => sseClients.delete(sessionId));
});

app.post("/mcp/message", (req, res) => {
  const { sessionId } = req.query;
  const { jsonrpc, id, method, params } = req.body;
  const client = sseClients.get(sessionId);
  function send(result) {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    if (client) client.write(`event: message\ndata: ${msg}\n\n`);
    res.json({ ok: true });
  }
  if (method === "initialize") return send({
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "svakom-toy", version: "1.0" }
  });
  if (method === "tools/list") return send({ tools: [
    { name: "toy_set_speed", description: "设置振动强度0-1", inputSchema: { type: "object", properties: { speed: { type: "number" }, sec: { type: "number" } } } },
    { name: "toy_set_pattern", description: "设置振动花样1-8", inputSchema: { type: "object", properties: { pattern: { type: "integer" }, level: { type: "number" } } } },
    { name: "toy_stop", description: "停止", inputSchema: { type: "object", properties: {} } },
    { name: "toy_status", description: "查询是否在线", inputSchema: { type: "object", properties: {} } }
  ]});
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "toy_status") return send({ content: [{ type: "text", text: "在线" }] });
    if (name === "toy_stop") queue.push({ stop: true });
    if (name === "toy_set_speed") queue.push({ speed: args.speed, sec: args.sec });
    if (name === "toy_set_pattern") queue.push({ pattern: args.pattern, level: args.level });
    return send({ content: [{ type: "text", text: "指令已发送" }] });
  }
  send({});
});

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("🚀 Bridge ready"));
