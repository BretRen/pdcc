import jwt from "jsonwebtoken";
const JWT_SECRET = "MarkisSBbut114514Ilikeplaywithhe."; // 生产环境用环境变量
import chalk from "chalk";
// 登录成功后生成 token
export function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyJWT(token, ws) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    ws.payload = payload.username;
    return true;
  } catch (e) {
    console.log(chalk.red("无效或过期的token，请重新登录"));
    return false;
  }
}
