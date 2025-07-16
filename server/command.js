import WebSocket from "ws";

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
