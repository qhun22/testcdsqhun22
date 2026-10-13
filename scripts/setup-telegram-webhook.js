import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  const devVarsPath = path.join(rootDir, ".dev.vars");
  if (!fs.existsSync(devVarsPath)) return null;
  const line = fs.readFileSync(devVarsPath, "utf8").split(/\r?\n/)
    .find((entry) => entry.trimStart().startsWith(`${name}=`));
  if (!line) return null;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

const token = readEnvVar("TELEGRAM_BOT_TOKEN");
const webhookSecret = readEnvVar("TELEGRAM_WEBHOOK_SECRET");
const action = process.argv[2] || "info";
const productionDomain = process.env.DEPLOY_DOMAIN || "https://testcdsqhun22.qhun22.workers.dev";

if (!token) {
  console.error("Thiếu TELEGRAM_BOT_TOKEN trong .dev.vars hoặc môi trường.");
  process.exit(1);
}

async function telegramApi(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(`Telegram ${method} failed with HTTP ${response.status}: ${result.description || "request failed"}`);
  }
  return result.result;
}

async function run() {
  if (action === "set") {
    if (!webhookSecret || !/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET phải dài 1-256 ký tự và chỉ gồm chữ, số, _ hoặc -.");
    }
    const webhookUrl = new URL("/api/telegram/webhook", productionDomain);
    if (webhookUrl.protocol !== "https:") throw new Error("DEPLOY_DOMAIN phải sử dụng HTTPS.");
    await telegramApi("setWebhook", {
      url: webhookUrl.toString(),
      secret_token: webhookSecret,
      allowed_updates: ["callback_query"]
    });
    console.log(`Webhook đã được đăng ký: ${webhookUrl.toString()}`);
    return;
  }
  if (action === "delete") {
    await telegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("Webhook đã được xóa; các update đang chờ được giữ lại.");
    return;
  }
  if (action === "info") {
    const info = await telegramApi("getWebhookInfo");
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  throw new Error("Dùng một trong các lệnh: info, set, delete.");
}

run().catch((exception) => {
  console.error(exception.message);
  process.exitCode = 1;
});
