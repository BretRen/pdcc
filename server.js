const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const readline = require("readline");
const bcrypt = require("bcrypt");

const wss = new WebSocket.Server({ port: 8080 });
const v = "1.0.8";
const db = new sqlite3.Database(path.resolve(__dirname, "pdcc.db"));

// 初始化用户表（确保字段名统一为 permission）
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  permission INTEGER DEFAULT 1,
  status TEXT DEFAULT 'activity'
)`);
// 应该为role，谢谢

console.log("✅ WebSocket 服务器运行在 ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("🟢 客户端已连接");

  ws.isAuthenticated = false;
  ws.permission = 0; // 未登录权限0
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

    // 未登录状态，仅允许 /login 和 /register 命令
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
          const saltRounds = 10;
          bcrypt.hash(password, saltRounds, (err, hash) => {
            if (err) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  data: "❌ 密码加密失败",
                })
              );
              return;
            }
            db.run(
              "INSERT INTO users(username, password, permission, status) VALUES(?, ?, 1, 'activity')",
              [username, hash],
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
                    console.log(err);
                    ws.send(
                      JSON.stringify({
                        type: "error",
                        data: "❌ 注册失败，请稍后再试",
                      })
                    );
                    console.error(err);
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
          });
        } else if (cmd === "/login") {
          // 先查出用户密码哈希，再用 bcrypt 验证
          db.get(
            "SELECT * FROM users WHERE username = ?",
            [username],
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

              if (!row) {
                ws.loginAttempts++;
                ws.send(
                  JSON.stringify({
                    type: "error",
                    data: "❌ 用户名或密码错误",
                  })
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
                return;
              }

              bcrypt.compare(password, row.password, (err, result) => {
                if (result) {
                  ws.isAuthenticated = true;
                  ws.username = row.username;
                  ws.permission = row.permission;
                  ws.status = row.status;
                  if (ws.status == "baned") {
                    ws.send(
                      JSON.stringify({
                        type: "error",
                        data: "你无权登录此账户",
                      })
                    );
                    ws.terminate();
                    return;
                  }
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
                    JSON.stringify({
                      type: "error",
                      data: "❌ 用户名或密码错误",
                    })
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
              });
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

    // 已登录用户消息处理
    if (data.type === "msg") {
      // 普通聊天消息广播给其他已登录客户端
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
      // 版本检测
      if (data.data != v) {
        ws.send(
          JSON.stringify({
            type: "error",
            data: `服务端和客户端版本不一致。\n服务端版本：${v}，你当前版本：${data.data}`,
          })
        );
        ws.close(1000, "版本不一致");
      }
    }
    // 客户端执行服务端权限命令
    else if (data.type === "command") {
      const commandPermissions = {
        "/kick": 4,
        "/ban": 4,
        "/unban": 4,
      };

      const parts = data.data.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (commandPermissions.hasOwnProperty(cmd)) {
        const requiredLevel = commandPermissions[cmd];
        if (ws.permission >= requiredLevel) {
          if (cmd === "/kick") {
            if (args.length < 1) {
              ws.send(
                JSON.stringify({ type: "error", data: "用法: /kick <用户名>" })
              );
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
                  JSON.stringify({ type: "error", data: "⛔ 你已被管理员踢出" })
                );
                client.close(4002, "被踢出");
                kicked = true;
              }
            }
            ws.send(
              JSON.stringify({
                type: "sys",
                data: kicked
                  ? `✅ 已成功踢出用户 ${targetUsername}`
                  : `⚠️ 未找到在线用户 ${targetUsername}`,
              })
            );
          } else if (cmd === "/ban") {
            if (args.length < 1) {
              ws.send(
                JSON.stringify({ type: "error", data: "用法: /ban <用户名>" })
              );
              return;
            }
            const targetUsername = args[0];

            // 更新数据库中用户状态为 baned
            db.run(
              "UPDATE users SET status = ? WHERE username = ?",
              ["baned", targetUsername],
              function (err) {
                if (err) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      data: "❌ 封禁失败：" + err.message,
                    })
                  );
                  return;
                }

                // 踢出目标用户
                let kicked = false;
                for (const client of wss.clients) {
                  if (
                    client.readyState === WebSocket.OPEN &&
                    client.username === targetUsername
                  ) {
                    client.send(
                      JSON.stringify({
                        type: "error",
                        data: "⛔ 你已被管理员封禁并踢出",
                      })
                    );
                    client.close(4003, "封禁踢出");
                    kicked = true;
                  }
                }

                ws.send(
                  JSON.stringify({
                    type: "sys",
                    data: `✅ 用户 ${targetUsername} 已封禁${
                      kicked ? "并踢出" : "（但当前未在线）"
                    }`,
                  })
                );
              }
            );
          }
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              data: `⛔ 权限不足，无法执行 ${cmd}`,
            })
          );
        }
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            data: `❓ 未知或不支持的服务端命令: ${cmd}`,
          })
        );
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

// 服务端控制台命令（权限等级为 -1，拥有所有权限）
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
