import fs from "fs";
import express from "express";
import { AkahuClient } from "akahu";

const [,, optionsPath] = process.argv;
const opts = JSON.parse(fs.readFileSync(optionsPath, "utf-8"));

const {
  akahu_app_id,
  akahu_user_token,
  account_from,
  account_to,
  min_balance_nzd,
  topup_amount_nzd,
  poll_seconds,
  webhook_secret
} = opts;

console.log("loaded opts", {
  app_id: akahu_app_id.slice(0, 16) + "…",
  user_token: akahu_user_token.slice(0, 18) + "…",
  account_from,
  account_to,
  min_balance_nzd,
  topup_amount_nzd,
  poll_seconds
});

if (!akahu_app_id || !akahu_user_token) {
  console.error("Missing akahu_app_id or akahu_user_token in options.");
  process.exit(1);
}

function assertTokenFormat() {
  if (!akahu_user_token.startsWith("user_token_")) {
    console.error("akahu_user_token looks wrong (should start with user_token_)");
    process.exit(1);
  }
  if (!akahu_app_id.startsWith("app_token_")) {
    console.error("akahu_app_id looks wrong (should start with app_token_)");
    process.exit(1);
  }
}
assertTokenFormat();

const akahu = new AkahuClient({
  appToken: akahu_app_id,       // X-Akahu-Id
});

const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const HA_API = "http://supervisor/core/api";

async function haCall(service, data) {
  const res = await fetch(`${HA_API}/services/${service}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPERVISOR_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HA service call failed ${res.status}: ${t}`);
  }
}

async function notify(title, message, actionUrl) {
  await haCall("persistent_notification/create", {
    title,
    message: `${message}\n\n[Transfer now](${actionUrl})`,
    notification_id: "markwr-auto-banker"
  });
}

async function currentBalanceNZD(acctId) {
  const acct = await akahu.accounts.get(akahu_user_token, acctId);
  const amount = (acct.balance)?.current;
  const currency = (acct.balance)?.currency;
  if (currency !== "NZD") throw new Error(`Expected NZD, got ${currency}`);
  return amount;
}

async function doTransferNZD(fromId, toId, amount, note="HA auto-move") {
  return akahu.transfers.create(akahu_user_token, {
    from: fromId,
    to: toId,
    amount: amount,
    meta: { note }
  });
}

async function pollLoop() {
  for (;;) {
    try {
      const bal = await currentBalanceNZD(account_to);
      const timeNow = new Date();
      console.log(timeNow.toISOString(), "Current Bal: $" + bal.toFixed(2));
      if (bal < min_balance_nzd) {
        const url = `${process.env.ADDON_WEB_URL}/transfer/${webhook_secret}`;
        await notify(
          "Low balance",
          `Account ${account_to} is ${bal.toFixed(2)} NZD (< ${min_balance_nzd}). Will transfer ${topup_amount_nzd} NZD from ${account_from} if you confirm.`,
          url
        );
      }
    } catch (e) {
      console.error("poll error:", e);
    }
    await new Promise(r => setTimeout(r, poll_seconds * 1000));
  }
}

const app = express();

app.get("/transfer/:secret", async (req, res) => {
  if (req.params.secret !== webhook_secret) return res.status(403).send("forbidden");
  try {
    const tx = await doTransferNZD(account_from, account_to, topup_amount_nzd);
    await notify("Top-up queued", `Transfer id ${tx._id} submitted for ${topup_amount_nzd} NZD.`, "#");
    res.send("Transfer submitted.");
  } catch (e) {
    console.error(e);
    await notify("Top-up failed", String(e), "#");
    res.status(500).send("error");
  }
});

const port = 8099;
app.listen(port, "0.0.0.0", () => {
  process.env.ADDON_WEB_URL ||= `http://homeassistant.local:8123/api/webhook/auto-banker-${webhook_secret}`;
  console.log("auto-banker listening");
});

pollLoop().catch(err => console.error(err));