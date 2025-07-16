import WebSocket from "ws";
import { spawn } from "child_process";
import path from "path";
import chalk from "chalk";
import fs from "fs";
function restart() {
  const scriptPath = path.resolve(process.argv[1]);
  console.log(chalk.green("[Restart] 正在重启:", scriptPath));
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
    console.log(chalk.green("已连接服务器"));
    try {
      const data = fs.readFileSync(".pdcc.login.token.txt", "utf8"); // 第二个参数是编码，常用utf8，读出来是字符串
      ws.send(JSON.stringify({ type: "command", data: "/login", token: data }));
    } catch (err) {
      console.error("读取token文件错误！", err);
    }
    prompt();
  });

  ws.on("message", (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch {
      console.log(chalk.yellow("收到非 JSON 消息：", rawData.toString()));
      return;
    }

    if (msg.type === "sys") {
      console.log(`\n系统消息: ${msg.data}`);
    } else if (msg.type === "echo") {
      console.log(`\n回显: ${msg.data}`);
    } else if (msg.type === "msg") {
      console.log(`\n聊天消息: ${msg.data}`);
    } else if (msg.type === "v") {
      ws.send(JSON.stringify({ type: "v", data: v }));
    } else if (msg.type === "error") {
      console.log(chalk.red(`\n ${msg.data}`));
    } else if (msg.type === "token") {
      fs.writeFile(".pdcc.login.token.txt", msg.data, "utf8", (err) => {
        if (err) {
          console.log(chalk.reg("Token保存失败", err));
        } else {
          console.log(chalk.green("token已保存，下次无需输入密码。"));
        }
      });
    } else {
      console.log(`\n[${msg.type}] ${msg.data}`);
    }

    prompt();
  });

  ws.on("close", () => {
    console.log(chalk.red("\n与服务器断开连接"));
  });

  ws.on("error", (err) => {
    console.log(chalk.red("\n连接错误:", err.message));
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
      console.log(" 可用命令: /help /quit /rejoin /restart");
      break;

    case "/quit":
      console.log("👋 已退出");
      process.exit(0);
      break;

    case "/rejoin":
      console.log(chalk.yellow("正在重新连接..."));
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
        console.log(chalk.yellow("未连接，消息未发送"));
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
