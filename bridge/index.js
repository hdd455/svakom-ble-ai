import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "";
const queue = [];
const sseClients = new Map();

function auth(req, res, next) {
  const s = req.headers["x-bridge-secret"] || req.query.secret || "";
  if (SECRET && s !== SECRET) return res.status(403).json({ error: "forbidden" });
  next();
}

// bridge.py轮询取指令
app.get("/toy-next", auth, (req, res) => {
  const cmd = queue.shift();
  res.json(cmd || {});
});

// MCP SSE连接
app.get("/mcp", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const sessionId = randomUUID();
  sseClients.set(sessionId, res);

  // 发送endpoint事件
  res.write(`event: endpoint\ndata: ${JSON.stringify({ uri: `/mcp/message?sessionId=${sessionId}` })}\n\n`);

  req.on("close", () => {
    sseClients.delete(sessionId);
  });
});

// MCP消息处理
app.post("/mcp/message", (req, res) => {
  const { sessionId } = req.query;
  const { jsonrpc, id, method, params } = req.body;
  const client = sseClients.get(sessionId);

  function send(result) {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    if (client) client.write(`event: message\ndata: ${msg}\n\n`);
    res.json({ ok: true });
  }

  if (method === "initialize") {
    return send({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "svakom-toy", version: "1.0" }
    });
  }

  if (method === "tools/list") {
    return send({
      tools: [
        { name: "toy_set_speed", description: "设置振动强度0-1", inputSchema: { type: "object", properties: { speed: { type: "number" }, sec: { type: "number" } } } },
        { name: "toy_set_pattern", description: "设置振动花样1-8", inputSchema: { type: "object", properties: { pattern: { type: "integer" }, level: { type: "number" } } } },
        { name: "toy_stop", description: "停止", inputSchema: { type: "object", properties: {} } },
        { name: "toy_status", description: "查询是否在线", inputSchema: { type: "object", properties: {} } }
      ]
    });
  }

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

app.options("/mcp", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

app.options("/mcp/message", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("🚀 Bridge ready"));
