import WebSocket from "ws";
import path from "path";
import { spawn } from "child_process";
// 处理踢出命令
export function handleKickCommand(ws, args, wss) {
  if (args.length < 1) {
    ws.send(JSON.stringify({ type: "error", data: "用法: /kick <用户名>" }));
    return;
  }
  const targetUsername = args[0];
  let kicked = false;
  for (const client of wss.clients) {
    if (
      client.readyState === WebSocket.OPEN &&
      client.username === targetUsername
    ) {
      client.send(JSON.stringify({ type: "error", data: "你已被管理员踢出" }));
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
}

// 处理封禁命令
export function handleBanCommand(ws, args, wss, db) {
  if (args.length < 1) {
    ws.send(JSON.stringify({ type: "error", data: "用法: /ban <用户名>" }));
    return;
  }

  const targetUsername = args[0];
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

export function reload(ws, wss, setupServer) {
  console.log("[LOG] Reload....");
  ws.send(
    JSON.stringify({
      type: "sys",
      data: "已经重新刷新整个服务器。",
    })
  );
  const scriptPath = path.resolve(process.argv[1]);
  spawn("cmd", ["/c", "start", "node", scriptPath], {
    detached: true,
    cwd: process.cwd(),
    stdio: "ignore",
  });
  process.exit(0);
}

export function unban(ws, args, wss, db) {
  if (args.length < 1) {
    ws.send(JSON.stringify({ type: "error", data: "用法: /unban <用户名>" }));
    return;
  }

  const targetUsername = args[0];
  db.run(
    "UPDATE users SET status = ? WHERE username = ?",
    ["activity", targetUsername],
    function (err) {
      if (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            data: " 解除封禁失败：" + err.message,
          })
        );
        return;
      }

      ws.send(
        JSON.stringify({
          type: "sys",
          data: `✅ 用户 ${targetUsername} 已解除封禁`,
        })
      );
    }
  );
}
export function banlist(ws, args, wss, db) {
  db.all("SELECT username FROM users WHERE status = 'baned'", (err, rows) => {
    if (err) {
      console.error("查询出错:", err);
      ws.send(
        JSON.stringify({
          type: "error",
          data: "获取封禁列表失败",
        })
      );
    } else if (rows.length > 0) {
      const list = rows.map((r) => `- ${r.username}`).join("\n");
      ws.send(
        JSON.stringify({
          type: "sys",
          data: `当前被封禁人员：\n${list}`,
        })
      );
    } else {
      ws.send(
        JSON.stringify({
          type: "sys",
          data: "当前没有任何被封禁的用户。",
        })
      );
    }
  });
}
