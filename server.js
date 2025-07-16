const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const wss = new WebSocket.Server({ port: 8080 });
const v = "1.0.6";

const db = new sqlite3.Database(path.resolve(__dirname, "pdcc.db"));

// 初始化用户表
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT
)`);

console.log("✅ WebSocket 服务器运行在 ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("🟢 客户端已连接");

  ws.isAuthenticated = false; // 是否登录成功
  ws.loginAttempts = 0; // 连续登录失败次数

  ws.send(JSON.stringify({ type: "v", data: v }));
  ws.send(
    JSON.stringify({
      type: "sys",
      data: "你好，欢迎连接到服务器！请先登录或注册（/login 用户名 密码 或 /register 用户名 密码）",
    })
  );

  // 30秒内未登录/注册踢出
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

    // 只允许登录/注册命令，或者已登录的客户端可以发送其他消息
    if (!ws.isAuthenticated) {
      // 仅允许 /login 和 /register 命令，且格式检查
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
          // 注册逻辑
          db.run(
            "INSERT INTO users(username, password) VALUES(?, ?)",
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
          // 登录逻辑
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
                clearTimeout(kickTimer); // 登录成功取消踢出计时
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
        // 未登录不能执行其他命令和消息
        ws.send(
          JSON.stringify({
            type: "error",
            data: "❌ 请先登录或注册，允许的命令：/login /register",
          })
        );
      }
      return; // 未登录状态下一律返回
    }

    // 认证后才允许处理其他消息
    if (data.type === "msg") {
      // 广播消息给其他客户端
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
