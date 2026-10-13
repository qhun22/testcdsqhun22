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
const localWebhookUrl = process.env.LOCAL_WEBHOOK_URL || "http://localhost:8787/api/telegram/webhook";

if (!token || !webhookSecret) {
  console.error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_WEBHOOK_SECRET trong .dev.vars.");
  process.exit(1);
}

let parsedWebhookUrl;
try {
  parsedWebhookUrl = new URL(localWebhookUrl);
} catch {
  console.error("LOCAL_WEBHOOK_URL không phải URL hợp lệ.");
  process.exit(1);
}
if (!["localhost", "127.0.0.1", "::1"].includes(parsedWebhookUrl.hostname)) {
  console.error("Poller chỉ được phép chuyển tiếp tới localhost.");
  process.exit(1);
}

async function telegramApi(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(`Telegram ${method} failed with HTTP ${response.status}.`);
  return result.result;
}

async function main() {
  const webhook = await telegramApi("getWebhookInfo");
  if (webhook.url) {
    throw new Error("Bot đang dùng webhook. Hãy chủ động chạy npm run telegram:delete-webhook trước khi polling local.");
  }

  console.log("Telegram local poller đang chạy. Nhấn Ctrl+C để dừng.");
  let offset = 0;
  while (true) {
    try {
      const updates = await telegramApi("getUpdates", { offset, timeout: 20, allowed_updates: ["callback_query"] });
      for (const update of updates) {
        if (update.callback_query) {
          const response = await fetch(localWebhookUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret
            },
            body: JSON.stringify(update),
            signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) {
            console.error(`Local webhook returned HTTP ${response.status}; update will be retried.`);
            break;
          }
        }
        offset = update.update_id + 1;
      }
    } catch (exception) {
      console.error("Telegram polling failed:", exception.message);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((exception) => {
  console.error(exception.message);
  process.exitCode = 1;
});
