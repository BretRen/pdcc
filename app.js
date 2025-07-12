const WebSocket = require("ws");

const USERS = {
  alice: "123456",
  bob: "abcdef",
};

const wss = new WebSocket.Server({ port: 12345 }, () => {
  console.log("[服务器] WebSocket 服务器已启动，监听 ws://localhost:12345");
});

const channels = {};

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[连接] 新客户端连接：${ip}`);

  ws.isAuthenticated = false;
  ws.username = null;
  ws.channel = null;

  ws.send(JSON.stringify({ type: "info", message: "请先登录" }));

  ws.on("message", (msg) => {
    console.log(`[接收] 原始消息：${msg}`);
    try {
      const data = JSON.parse(msg);

      if (data.type === "login") {
        const { username, password } = data;
        console.log(`[登录] 用户尝试登录：${username}`);
        if (USERS[username] && USERS[username] === password) {
          ws.isAuthenticated = true;
          ws.username = username;
          ws.send(JSON.stringify({ type: "login", success: true }));
          console.log(`[登录] ✅ 登录成功：${username}`);
        } else {
          ws.send(
            JSON.stringify({
              type: "login",
              success: false,
              error: "用户名或密码错误",
            })
          );
          console.log(`[登录] ❌ 登录失败：${username}`);
        }
        return;
      }

      if (data.type === "join" && ws.isAuthenticated) {
        const { channel } = data;
        if (!channels[channel]) channels[channel] = new Set();
        channels[channel].add(ws);
        ws.channel = channel;
        ws.send(JSON.stringify({ type: "joined", channel }));
        console.log(`[频道] 用户 ${ws.username} 加入频道：${channel}`);
        return;
      }

      if (data.type === "message" && ws.isAuthenticated && ws.channel) {
        const message = {
          type: "message",
          from: ws.username,
          channel: ws.channel,
          content: data.content,
        };

        console.log(`[广播] ${ws.username}@${ws.channel}：${data.content}`);

        for (const client of channels[ws.channel]) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
          }
        }
        return;
      }

      // 如果没有通过身份验证或其他非法操作
      if (!ws.isAuthenticated) {
        console.warn(`[警告] 未认证用户尝试操作：${msg}`);
        ws.send(JSON.stringify({ type: "error", message: "请先登录" }));
        return;
      }
    } catch (e) {
      console.error(`[错误] JSON 解析失败或未知错误：`, e.message);
      ws.send(JSON.stringify({ type: "error", message: "消息格式错误" }));
    }
  });

  ws.on("close", () => {
    console.log(`[断开] 用户断开连接：${ws.username || ip}`);
    if (ws.channel && channels[ws.channel]) {
      channels[ws.channel].delete(ws);
      console.log(`[频道] 从频道 ${ws.channel} 移除用户：${ws.username}`);
    }
  });
});
