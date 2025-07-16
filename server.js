const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const readline = require("readline");

const wss = new WebSocket.Server({ port: 8080 });
const v = "1.0.7";
const db = new sqlite3.Database(path.resolve(__dirname, "pdcc.db"));

// 初始化用户表（增加权限字段）
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  permission INTEGER DEFAULT 1
)`);

console.log("✅ WebSocket 服务器运行在 ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("🟢 客户端已连接");

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
        JSON.stringify({ type: "error", data: "❌ 超过30秒未登录，已被踢出" })
      );
      ws.close(4000, "未登录超时");
    }
  }, 30000);

  ws.on("message", (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          data: "❌ 非法消息格式（必须是 JSON）",
        })
      );
      return;
    }

    if (!ws.isAuthenticated) {
      if (
        data.type === "command" &&
        (data.data.startsWith("/login ") || data.data.startsWith("/register "))
      ) {
        const parts = data.data.trim().split(/\s+/);
        const cmd = parts[0];
        const username = parts[1];
        const password = parts[2];

        if (!username || !password) {
          ws.send(
            JSON.stringify({
              type: "error",
              data: `❌ 格式错误，正确格式: ${cmd} 用户名 密码`,
            })
          );
          return;
        }

        if (cmd === "/register") {
          db.run(
            "INSERT INTO users(username, password, permission) VALUES(?, ?, 1)",
            [username, password],
            function (err) {
              if (err) {
                if (err.message.includes("UNIQUE")) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      data: "❌ 用户名已存在，请换一个",
                    })
                  );
                } else {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      data: "❌ 注册失败，请稍后再试",
                    })
                  );
                }
              } else {
                ws.send(
                  JSON.stringify({
                    type: "sys",
                    data: "✅ 注册成功，请使用 /login 登录",
                  })
                );
              }
            }
          );
        } else if (cmd === "/login") {
          db.get(
            "SELECT * FROM users WHERE username = ? AND password = ?",
            [username, password],
            (err, row) => {
              if (err) {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    data: "❌ 登录失败，请稍后再试",
                  })
                );
                return;
              }
              if (row) {
                ws.isAuthenticated = true;
                ws.username = row.username;
                ws.permission = row.permission;
                clearTimeout(kickTimer);
                ws.send(
                  JSON.stringify({
                    type: "sys",
                    data: "✅ 登录成功，可以开始聊天了",
                  })
                );
              } else {
                ws.loginAttempts++;
                ws.send(
                  JSON.stringify({ type: "error", data: "❌ 用户名或密码错误" })
                );
                if (ws.loginAttempts >= 3) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      data: "❌ 连续登录失败3次，已断开连接",
                    })
                  );
                  ws.close(4001, "连续登录失败");
                }
              }
            }
          );
        }
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            data: "❌ 请先登录或注册，允许的命令：/login /register",
          })
        );
      }
      return;
    }

    if (data.type === "msg") {
      for (const client of wss.clients) {
        if (
          client !== ws &&
          client.readyState === WebSocket.OPEN &&
          client.isAuthenticated
        ) {
          client.send(JSON.stringify({ type: "msg", data: data.data }));
        }
      }
    } else if (data.type === "v") {
      if (data.data != v) {
        ws.send(
          JSON.stringify({
            type: "error",
            data: `服务端和客户端版本不一致。\n服务端版本：${v}，你当前版本：${data.data}`,
          })
        );
        ws.close(1000, "版本不一致");
      }
    } else {
      ws.send(
        JSON.stringify({
          type: "error",
          data: `❓ 不支持的消息类型: ${data.type}`,
        })
      );
    }
  });

  ws.on("close", () => {
    console.log("🔴 客户端断开连接");
    clearTimeout(kickTimer);
  });
});

//
// 服务端控制台命令（权限等级为 -1，拥有所有权限）
//
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
      console.log("⛔ 权限不足，无法执行 /kick");
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
          JSON.stringify({
            type: "error",
            data: "⛔ 你已被管理员踢出",
          })
        );
        client.close(4002, "被踢出");
        console.log(`✅ 已踢出用户 ${targetUsername}`);
        kicked = true;
      }
    }
    if (!kicked) {
      console.log(`⚠️ 没有找到用户名为 ${targetUsername} 的在线用户`);
    }
  } else {
    console.log("❓ 未知命令，请输入 /help 查看可用命令");
  }
  rl.prompt();
}

rl.on("line", handleServerCommand);
rl.setPrompt("> ");
rl.prompt();
