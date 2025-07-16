import WebSocket, { WebSocketServer } from "ws";
import sqlite3 from "sqlite3";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import fs from "fs"; // ESM写法
import * as command from "./server/command.js"; // 注意要加 .js 后缀
import * as auth from "./server/auth.js"; // 注意要加 .js 后缀

// 初始化服务器
function setupServer() {
  const wss = new WebSocketServer({ port: 8080 });
  const v = "1.0.8";
  const sqlite = sqlite3.verbose();
  // ES 模块下获取当前文件和目录路径
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const db = new sqlite.Database(path.resolve(__dirname, "pdcc.db"));

  let commandPermissions = {}; // 先声明变量

  try {
    const data = fs.readFileSync("./server/command.json", "utf8");
    try {
      commandPermissions = JSON.parse(data);
      console.log("解析后的对象:", commandPermissions);
    } catch (parseErr) {
      console.error("JSON 解析失败:", parseErr);
    }
  } catch (err) {
    console.error("读取文件失败:", err);
  }
  // 初始化数据库表
  function initDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      permission INTEGER DEFAULT 1,
      status TEXT DEFAULT 'activity'
    )`);
  }

  // 处理客户端连接
  function handleConnection(ws) {
    console.log("[Client] 客户端已连接");

    ws.isAuthenticated = false;
    ws.permission = 0;
    ws.loginAttempts = 0;

    ws.send(JSON.stringify({ type: "v", data: v }));
    ws.send(
      JSON.stringify({
        type: "sys",
        data: "你好，欢迎连接到服务器！请先登录或注册（/login 用户名 密码 或 /register 用户名 密码）",
      })
    );

    const kickTimer = setTimeout(() => {
      if (!ws.isAuthenticated) {
        ws.send(
          JSON.stringify({ type: "error", data: "超过30秒未登录，已被踢出" })
        );
        ws.close(4000, "未登录超时");
        console.log("[ERROR] 超过30秒未登录，已被踢出");
      }
    }, 30000);

    // 处理消息
    ws.on("message", (rawData) =>
      handleMessage(ws, rawData, wss, kickTimer, commandPermissions)
    );

    ws.on("close", () => {
      console.log(" 客户端断开连接");
      clearTimeout(kickTimer);
    });
  }

  // 处理消息
  function handleMessage(ws, rawData, wss, kickTimer, commandPermissions) {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch (e) {
      ws.send(
        JSON.stringify({ type: "error", data: " 非法消息格式（必须是 JSON）" })
      );
      return;
    }

    if (!ws.isAuthenticated) {
      auth.handleUnauthenticated(ws, data, kickTimer, db);
      return;
    }

    switch (data.type) {
      case "msg":
        broadcastMessage(wss, ws, data.data);
        break;
      case "v":
        checkVersion(ws, data.data, v);
        break;
      case "command":
        handleCommand(ws, data.data, wss, db, commandPermissions);
        break;
      default:
        ws.send(
          JSON.stringify({
            type: "error",
            data: ` 不支持的消息类型: ${data.type}`,
          })
        );
    }
  }

  // 广播消息
  function broadcastMessage(wss, sender, message) {
    for (const client of wss.clients) {
      if (
        client !== sender &&
        client.readyState === WebSocket.OPEN &&
        client.isAuthenticated
      ) {
        client.send(JSON.stringify({ type: "msg", data: message }));
      }
    }
  }

  // 检查版本
  function checkVersion(ws, clientVersion, serverVersion) {
    if (clientVersion != serverVersion) {
      ws.send(
        JSON.stringify({
          type: "error",
          data: `服务端和客户端版本不一致。\n服务端版本：${serverVersion}，你当前版本：${clientVersion}`,
        })
      );
      ws.close(1000, "版本不一致");
    }
  }

  // 处理命令
  function handleCommand(ws, commandStr, wss, db, commandPermissions) {
    const tokens = commandStr.trim().split(/\s+/);
    const fullCmd = tokens.slice(0, 2).join(" ").toLowerCase();
    const fallbackCmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    // console.log(`[LOG] ${commandPermissions}`);

    const cmdToCheck =
      commandPermissions[fullCmd] !== undefined ? fullCmd : fallbackCmd;
    const requiredLevel = commandPermissions[cmdToCheck];

    if (!requiredLevel) {
      ws.send(
        JSON.stringify({
          type: "error",
          data: `❓ 未知或不支持的服务端命令: ${fallbackCmd}`,
        })
      );
      return;
    }

    if (ws.permission < requiredLevel) {
      ws.send(
        JSON.stringify({
          type: "error",
          data: `⛔ 权限不足，无法执行 ${cmdToCheck}`,
        })
      );
      return;
    }

    if (fallbackCmd === "/kick") {
      command.handleKickCommand(ws, args, wss);
    } else if (fallbackCmd === "/ban") {
      command.handleBanCommand(ws, args, wss, db);
    }
  }

  // 设置控制台命令
  function setupConsoleCommands(wss) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const serverPermission = -1;

    function handleServerCommand(cmdLine) {
      const parts = cmdLine.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      if (cmd === "/help") {
        console.log("🆘 可用服务端命令: /help /quit /kick <用户名>");
      } else if (cmd === "/quit") {
        console.log("👋 服务器即将关闭...");
        process.exit(0);
      } else if (cmd === "/kick") {
        if (serverPermission !== -1 && serverPermission < 4) {
          console.log(" 权限不足，无法执行 /kick");
          return;
        }

        if (args.length < 1) {
          console.log("用法: /kick <用户名>");
          return;
        }
        const targetUsername = args[0];
        let kicked = false;
        for (const client of wss.clients) {
          if (
            client.readyState === WebSocket.OPEN &&
            client.username === targetUsername
          ) {
            client.send(
              JSON.stringify({ type: "error", data: " 你已被管理员踢出" })
            );
            client.close(4002, "被踢出");
            console.log(` 已踢出用户 ${targetUsername}`);
            kicked = true;
          }
        }
        if (!kicked) {
          console.log(` 没有找到用户名为 ${targetUsername} 的在线用户`);
        }
      } else {
        console.log(" 未知命令，请输入 /help 查看可用命令");
      }
      rl.prompt();
    }

    rl.on("line", handleServerCommand);
    rl.setPrompt("> ");
    rl.prompt();
  }

  // 启动服务器
  initDatabase();
  wss.on("connection", handleConnection);
  setupConsoleCommands(wss);
  console.log("[LOG] WebSocket 服务器运行在 ws://localhost:8080");
}

// 启动服务器
setupServer();
