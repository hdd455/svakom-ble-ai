// OAuth discovery
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({ issuer: "https://svakom-ble-ai-production-03c6.up.railway.app" });
});import express from "express";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "";
const queue = [];

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

// MCP Server端点
app.get("/mcp", auth, (req, res) => {
  res.json({
    name: "svakom-toy",
    version: "1.0",
    tools: [
      { name: "toy_set_speed", description: "设置振动强度0-1", inputSchema: { type: "object", properties: { speed: { type: "number" }, sec: { type: "number" } } } },
      { name: "toy_set_pattern", description: "设置振动花样1-8", inputSchema: { type: "object", properties: { pattern: { type: "integer" }, level: { type: "number" } } } },
      { name: "toy_stop", description: "停止", inputSchema: { type: "object", properties: {} } },
      { name: "toy_status", description: "查询是否在线", inputSchema: { type: "object", properties: {} } }
    ]
  });
});

app.post("/mcp", auth, (req, res) => {
  const { method, params } = req.body;
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "toy_status") return res.json({ result: { content: [{ type: "text", text: "在线" }] } });
    if (name === "toy_stop") queue.push({ stop: true });
    if (name === "toy_set_speed") queue.push({ speed: args.speed, sec: args.sec });
    if (name === "toy_set_pattern") queue.push({ pattern: args.pattern, level: args.level });
    return res.json({ result: { content: [{ type: "text", text: "指令已发送" }] } });
  }
  res.json({});
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("🚀 Bridge ready"));
