const WebSocket = require("ws");
const { spawn } = require("child_process");
const path = require("path");

const url = "ws://localhost:8080";
const v = "1.0.6";

let ws;
let isAuthenticated = false;

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

    switch (msg.type) {
      case "sys":
        console.log(`\n📢 系统消息: ${msg.data}`);
        if (msg.data.includes("登录成功")) {
          isAuthenticated = true;
        }
        break;
      case "echo":
        console.log(`\n📨 回显: ${msg.data}`);
        break;
      case "msg":
        console.log(`\n💬 聊天消息: ${msg.data}`);
        break;
      case "v":
        ws.send(JSON.stringify({ type: "v", data: v }));
        break;
      case "error":
        console.log(`\n\x1b[31m[ERROR] ${msg.data}\x1b[0m`);
        break;
      default:
        console.log(`\n🔖 [${msg.type}] ${msg.data}`);
        break;
    }

    prompt();
  });

  ws.on("close", () => {
    console.log("\n❌ 与服务器断开连接");
    isAuthenticated = false;
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

  const canUseAlways = ["/quit", "/rejoin", "/restart", "/help"];
  const canUseBeforeLogin = ["/login", "/register"];

  // 连接状态判断
  const connected = ws && ws.readyState === WebSocket.OPEN;

  if (!connected) {
    // 未连接时，只允许某些本地命令
    if (!canUseAlways.includes(cmd)) {
      console.log("\x1b[F\x1b[2K"); // 清除当前输入行
      console.log("⚠️ 尚未连接服务器，可用命令：/rejoin /quit /restart /help");
      prompt();
      return;
    }
  } else if (!isAuthenticated) {
    // 已连接但未登录时，只允许登录注册命令和本地命令
    if (!canUseBeforeLogin.includes(cmd) && !canUseAlways.includes(cmd)) {
      console.log("\x1b[F\x1b[2K"); // 清除当前输入行
      console.log(
        "⚠️ 请先登录或注册，允许的命令：/login /register /quit /rejoin /restart /help"
      );
      prompt();
      return;
    }
  }

  switch (cmd) {
    case "/help":
      console.log("🆘 可用命令: /help /quit /rejoin /restart /login /register");
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

    case "/login":
    case "/register":
      if (parts.length !== 3) {
        console.log(`⚠️ 格式错误，正确格式: ${cmd} 用户名 密码`);
        break;
      }
      ws.send(JSON.stringify({ type: "command", data: cmdLine }));
      break;

    default:
      // 普通聊天消息
      if (ws && ws.readyState === WebSocket.OPEN && isAuthenticated) {
        ws.send(JSON.stringify({ type: "msg", data: cmdLine }));
      } else {
        process.stdout.write("\x1b[F\x1b[2K");
        console.log("⚠️ 未连接或未登录，消息未发送");
      }
      break;
  }
  prompt();
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const input = chunk.toString().trim();
  if (input.startsWith("/")) {
    handleCommand(input);
  } else {
    handleCommand(input); // 普通消息
  }
});

connect();
