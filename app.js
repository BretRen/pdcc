const WebSocket = require("ws");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const SERVER_VERSION = "2.0.0";
const SALT_ROUNDS = 10;

const wss = new WebSocket.Server({ port: 12345 }, () => {
  console.log("[服务器] WebSocket 服务器已启动，监听 ws://localhost:12345");
});

const db = new sqlite3.Database("./chat.db", (err) => {
  if (err) {
    console.error("[数据库] 打开失败:", err.message);
    process.exit(1);
  }
  console.log("[数据库] 已连接");
});

// 初始化数据库表
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user INTEGER NOT NULL,
      to_user INTEGER NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending/accepted/rejected
      UNIQUE(user_id, friend_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS blacklist (
      user_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      UNIQUE(user_id, blocked_id)
    )
  `);
});

// 工具函数
function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function createUser(username, password) {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
      if (err) return reject(err);
      db.run(
        "INSERT INTO users (username, password) VALUES (?, ?)",
        [username, hash],
        function (err2) {
          if (err2) return reject(err2);
          resolve({ id: this.lastID, username });
        }
      );
    });
  });
}

function sendFriendRequest(userId, friendId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')",
      [userId, friendId],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function respondToFriendRequest(userId, friendId, status) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?",
      [status, friendId, userId],
      function (err) {
        if (err) return reject(err);
        if (status === "accepted") {
          db.run(
            "INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')",
            [userId, friendId],
            function (err2) {
              if (err2) return reject(err2);
              resolve(true);
            }
          );
        } else {
          resolve(true);
        }
      }
    );
  });
}

function removeFriend(userId, friendId) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
      [userId, friendId, friendId, userId],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function addBlacklist(userId, blockedId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR IGNORE INTO blacklist (user_id, blocked_id) VALUES (?, ?)",
      [userId, blockedId],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function removeBlacklist(userId, blockedId) {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM blacklist WHERE user_id = ? AND blocked_id = ?",
      [userId, blockedId],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function getFriendList(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT friend_id, status FROM friends WHERE user_id = ?",
      [userId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function getPendingFriendRequests(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT user_id FROM friends WHERE friend_id = ? AND status = 'pending'",
      [userId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map((r) => r.user_id));
      }
    );
  });
}

function getBlacklist(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT blocked_id FROM blacklist WHERE user_id = ?",
      [userId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map((r) => r.blocked_id));
      }
    );
  });
}

function saveMessage(fromId, toId, content) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO messages (from_user, to_user, content) VALUES (?, ?, ?)",
      [fromId, toId, content],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getChatHistory(userId, friendId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT 
        from_user as fromId, 
        to_user as toId, 
        content as text, 
        strftime('%Y-%m-%d %H:%M:%S', timestamp) as timestamp 
      FROM messages 
      WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?) 
      ORDER BY timestamp`,
      [userId, friendId, friendId, userId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function getUsernames(uids) {
  return new Promise((resolve, reject) => {
    const placeholders = uids.map(() => "?").join(",");
    db.all(
      `SELECT id, username FROM users WHERE id IN (${placeholders})`,
      uids,
      (err, rows) => {
        if (err) return reject(err);
        const usernameMap = {};
        rows.forEach((row) => {
          usernameMap[row.id] = row.username;
        });
        resolve(usernameMap);
      }
    );
  });
}

const clients = new Map(); // ws -> { id, username }

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "info", message: "请先登录或注册" }));

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "register") {
        const { username, password, version } = data;
        if (version !== SERVER_VERSION)
          return ws.send(
            JSON.stringify({
              type: "register",
              success: false,
              error: "客户端版本不兼容",
            })
          );

        const existing = await getUserByUsername(username);
        if (existing)
          return ws.send(
            JSON.stringify({
              type: "register",
              success: false,
              error: "用户名已存在",
            })
          );

        const user = await createUser(username, password);
        ws.send(
          JSON.stringify({
            type: "register",
            success: true,
            uid: user.id,
            username: user.username,
          })
        );
        return;
      }

      if (data.type === "login") {
        const { username, password, version } = data;
        if (version !== SERVER_VERSION)
          return ws.send(
            JSON.stringify({
              type: "login",
              success: false,
              error: "客户端版本不兼容",
            })
          );

        const user = await getUserByUsername(username);
        if (!user || !(await bcrypt.compare(password, user.password))) {
          return ws.send(
            JSON.stringify({
              type: "login",
              success: false,
              error: "用户名或密码错误",
            })
          );
        }

        clients.set(ws, { id: user.id, username: user.username });

        const friends = await getFriendList(user.id);
        const pendingRequests = await getPendingFriendRequests(user.id);
        const blacklist = await getBlacklist(user.id);

        const allUserIds = [
          ...friends.map((f) => f.friend_id),
          ...pendingRequests,
          ...blacklist,
          user.id,
        ];
        const usernameMap = await getUsernames(allUserIds);

        ws.send(
          JSON.stringify({
            type: "login",
            success: true,
            uid: user.id,
            username: user.username,
            friends: friends
              .filter((f) => f.status === "accepted")
              .map((f) => f.friend_id),
            pendingRequests,
            blacklist,
            usernameMap,
          })
        );
        return;
      }

      const client = clients.get(ws);
      if (!client)
        return ws.send(JSON.stringify({ type: "error", message: "未登录" }));

      if (data.type === "send_friend_request") {
        const { identifier } = data;
        let target;
        if (/^\d+$/.test(identifier)) {
          target = await getUserById(parseInt(identifier));
        } else {
          target = await getUserByUsername(identifier);
        }

        if (!target)
          return ws.send(
            JSON.stringify({ type: "error", message: "用户不存在" })
          );
        if (target.id === client.id)
          return ws.send(
            JSON.stringify({ type: "error", message: "不能添加自己为好友" })
          );

        await sendFriendRequest(client.id, target.id);

        // 通知目标用户
        for (const [ws2, c] of clients) {
          if (c.id === target.id) {
            ws2.send(
              JSON.stringify({
                type: "friend_request",
                fromId: client.id,
                fromName: client.username,
              })
            );
            break;
          }
        }

        ws.send(
          JSON.stringify({
            type: "friend_request_sent",
            success: true,
            toId: target.id,
            toName: target.username,
          })
        );
        return;
      }

      if (data.type === "respond_friend_request") {
        const { fromId, accept } = data;
        const target = await getUserById(fromId);
        if (!target)
          return ws.send(
            JSON.stringify({ type: "error", message: "用户不存在" })
          );

        const status = accept ? "accepted" : "rejected";
        await respondToFriendRequest(client.id, fromId, status);

        if (accept) {
          // 通知双方好友关系建立
          ws.send(
            JSON.stringify({
              type: "friend_added",
              friendId: fromId,
              friendName: target.username,
            })
          );

          for (const [ws2, c] of clients) {
            if (c.id === fromId) {
              ws2.send(
                JSON.stringify({
                  type: "friend_added",
                  friendId: client.id,
                  friendName: client.username,
                })
              );
              break;
            }
          }
        }

        ws.send(
          JSON.stringify({
            type: "friend_request_responded",
            success: true,
            fromId,
            accepted: accept,
          })
        );
        return;
      }

      if (data.type === "remove_friend") {
        const target = await getUserById(data.friendId);
        if (!target)
          return ws.send(
            JSON.stringify({ type: "error", message: "用户不存在" })
          );

        await removeFriend(client.id, target.id);

        // 通知对方（如果在线）
        for (const [ws2, c] of clients) {
          if (c.id === target.id) {
            ws2.send(
              JSON.stringify({
                type: "friend_removed",
                friendId: client.id,
              })
            );
            break;
          }
        }

        ws.send(
          JSON.stringify({
            type: "friend_removed",
            success: true,
            friendId: target.id,
          })
        );
        return;
      }

      if (data.type === "block") {
        const target = await getUserById(data.userId);
        if (!target)
          return ws.send(
            JSON.stringify({ type: "error", message: "用户不存在" })
          );

        await addBlacklist(client.id, target.id);
        ws.send(
          JSON.stringify({
            type: "blacklist_added",
            success: true,
            blockedId: target.id,
            blockedName: target.username,
          })
        );
        return;
      }

      if (data.type === "unblock") {
        const target = await getUserById(data.userId);
        if (!target)
          return ws.send(
            JSON.stringify({ type: "error", message: "用户不存在" })
          );

        await removeBlacklist(client.id, target.id);
        ws.send(
          JSON.stringify({
            type: "blacklist_removed",
            success: true,
            blockedId: target.id,
          })
        );
        return;
      }

      if (data.type === "message") {
        const toUser = await getUserById(data.toId);
        if (!toUser)
          return ws.send(
            JSON.stringify({ type: "error", message: "目标用户不存在" })
          );

        await saveMessage(client.id, toUser.id, data.text);

        // 发送给目标用户
        for (const [ws2, c] of clients) {
          if (c.id === toUser.id) {
            ws2.send(
              JSON.stringify({
                type: "message",
                fromId: client.id,
                toId: toUser.id,
                text: data.text,
                timestamp: new Date().toISOString(),
              })
            );
            break;
          }
        }

        // 确认消息已发送
        ws.send(
          JSON.stringify({
            type: "message_sent",
            success: true,
            toId: toUser.id,
            text: data.text,
          })
        );
        return;
      }

      if (data.type === "chat_history") {
        const history = await getChatHistory(client.id, data.friendId);
        ws.send(
          JSON.stringify({
            type: "chat_history",
            friendId: data.friendId,
            history,
          })
        );
        return;
      }

      if (data.type === "query_usernames") {
        const usernameMap = await getUsernames(data.uids);
        ws.send(
          JSON.stringify({
            type: "usernames",
            map: usernameMap,
          })
        );
        return;
      }
    } catch (err) {
      console.error("[错误] 无法处理消息:", err);
      ws.send(JSON.stringify({ type: "error", message: "服务器错误" }));
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (client) {
      console.log(`[连接] 用户 ${client.username} 断开连接`);
      clients.delete(ws);
    }
  });
});
