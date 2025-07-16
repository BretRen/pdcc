import bcrypt from "bcrypt";
// 处理未认证用户
export function handleUnauthenticated(ws, data, kickTimer, db) {
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
          data: ` 格式错误，正确格式: ${cmd} 用户名 密码`,
        })
      );
      return;
    }

    if (cmd === "/register") {
      handleRegister(ws, username, password, db);
    } else if (cmd === "/login") {
      handleLogin(ws, username, password, db, kickTimer);
    }
  } else {
    ws.send(
      JSON.stringify({
        type: "error",
        data: " 请先登录或注册，允许的命令：/login /register",
      })
    );
  }
}

// 处理注册
function handleRegister(ws, username, password, db) {
  const saltRounds = 10;
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      ws.send(JSON.stringify({ type: "error", data: " 密码加密失败" }));
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
                data: " 用户名已存在，请换一个",
              })
            );
          } else {
            console.error(err);
            ws.send(
              JSON.stringify({ type: "error", data: " 注册失败，请稍后再试" })
            );
          }
        } else {
          ws.send(
            JSON.stringify({
              type: "sys",
              data: " 注册成功，请使用 /login 登录",
            })
          );
        }
      }
    );
  });
}

// 处理登录
export function handleLogin(ws, username, password, db, kickTimer) {
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
    if (err) {
      ws.send(JSON.stringify({ type: "error", data: " 登录失败，请稍后再试" }));
      return;
    }

    if (!row) {
      handleFailedLogin(ws);
      return;
    }

    bcrypt.compare(password, row.password, (err, result) => {
      if (result) {
        handleSuccessfulLogin(ws, row, kickTimer);
      } else {
        handleFailedLogin(ws);
      }
    });
  });
}

// 处理登录失败
export function handleFailedLogin(ws) {
  ws.loginAttempts++;
  ws.send(JSON.stringify({ type: "error", data: " 用户名或密码错误" }));
  if (ws.loginAttempts >= 3) {
    ws.send(
      JSON.stringify({ type: "error", data: " 连续登录失败3次，已断开连接" })
    );
    ws.close(4001, "连续登录失败");
  }
}

// 处理成功登录
export function handleSuccessfulLogin(ws, row, kickTimer) {
  ws.isAuthenticated = true;
  ws.username = row.username;
  ws.permission = row.permission;
  ws.status = row.status;

  if (ws.status == "baned") {
    ws.send(JSON.stringify({ type: "error", data: "你无权登录此账户" }));
    ws.terminate();
    return;
  }

  clearTimeout(kickTimer);
  ws.send(JSON.stringify({ type: "sys", data: " 登录成功，可以开始聊天了" }));
}
