const WebSocket = require("ws");
const { spawn } = require("child_process");
const path = require("path");

function restart() {
  const scriptPath = path.resolve(process.argv[1]);
  console.log("♻️ 正在重启:", scriptPath);
  spawn("cmd", ["/c", "start", "node", scriptPath], {
    detached: true,
    cwd: process.cwd(),
    stdio: "ignore",
  });
  process.exit(0);
}

let ws;
const url = "ws://localhost:8080";
const v = "1.0.8";

function connect() {
  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("✅ 已连接服务器，输入你要说的话：");
    prompt();
  });

  ws.on("message", (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      console.log("⚠️ 收到非 JSON 消息：", rawData.toString());
      return;
    }

    if (msg.type === "sys") {
      console.log(`\n📢 系统消息: ${msg.data}`);
    } else if (msg.type === "echo") {
      console.log(`\n📨 回显: ${msg.data}`);
    } else if (msg.type === "msg") {
      console.log(`\n💬 聊天消息: ${msg.data}`);
    } else if (msg.type === "v") {
      ws.send(JSON.stringify({ type: "v", data: v }));
    } else if (msg.type === "error") {
      console.log(`\n\x1b[31m[ERROR] ${msg.data}\x1b[0m`);
    } else {
      console.log(`\n🔖 [${msg.type}] ${msg.data}`);
    }

    prompt();
  });

  ws.on("close", () => {
    console.log("\n❌ 与服务器断开连接");
  });

  ws.on("error", (err) => {
    console.log("\n❌ 连接错误:", err.message);
  });
}

function prompt() {
  process.stdout.write("");
}

function handleCommand(cmdLine) {
  const parts = cmdLine.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case "/help":
      console.log("🆘 可用命令: /help /quit /rejoin /restart");
      break;

    case "/quit":
      console.log("👋 已退出");
      process.exit(0);
      break;

    case "/rejoin":
      console.log("🔄 正在重新连接...");
      if (ws) ws.terminate();
      connect();
      break;

    case "/restart":
      restart();
      break;

    default:
      if (ws && ws.readyState === WebSocket.OPEN) {
        // 以 command 类型发送命令（如 /login、/register）
        if (cmdLine.startsWith("/")) {
          ws.send(JSON.stringify({ type: "command", data: cmdLine }));
        } else {
          ws.send(JSON.stringify({ type: "msg", data: cmdLine }));
        }
      } else {
        process.stdout.write("\x1b[F\x1b[2K");
        console.log("⚠️ 未连接，消息未发送");
      }
      break;
  }

  prompt();
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const input = chunk.toString().trim();
  handleCommand(input);
});

connect();
