// init-db.js
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./users.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // 添加一些测试用户
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)"
  );
  stmt.run("alice", "123456");
  stmt.run("bob", "abcdef");
  stmt.run("mark", "666");
  stmt.run("pidan", "999");
  stmt.finalize();

  console.log("✅ 用户表已初始化");
});

db.close();
