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

if (!akahu_app_id || !akahu_user_token) {
  console.error("Missing akahu_app_id or akahu_user_token in options.");
  process.exit(1);
}

const akahu = new AkahuClient({
  appToken: akahu_app_id,       // X-Akahu-Id
  userToken: akahu_user_token,  // Bearer
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
  // Use persistent_notification.create (shows up in HA UI). :contentReference[oaicite:6]{index=6}
  await haCall("persistent_notification/create", {
    title,
    message: `${message}\n\n[Transfer now](${actionUrl})`,
    notification_id: "markwr-auto-banker"
  });
}

async function currentBalanceNZD(acctId) {
  // accounts have balance & available fields; use available if present. :contentReference[oaicite:7]{index=7}
  const acct = await akahu.accounts.get(acctId);
  // Prefer "available" (what you can spend) else "balance"
  const amount = (acct.available ?? acct.balance)?.amount;
  const currency = (acct.available ?? acct.balance)?.currency;
  if (currency !== "NZD") throw new Error(`Expected NZD, got ${currency}`);
  return amount;
}

async function doTransferNZD(fromId, toId, amount, note="HA auto-move") {
  // Akahu "transfers" move money between the user’s own connected accounts. :contentReference[oaicite:8]{index=8}
  return akahu.transfers.create({
    from: fromId,
    to: toId,
    amount: { amount, currency: "NZD" },
    meta: { note }
  });
}

async function pollLoop() {
  for (;;) {
    try {
      const bal = await currentBalanceNZD(account_to);
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

// Tiny HTTP server to accept the “Transfer now” click
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

// Expose on 0.0.0.0 so HA can reverse-proxy it; we’ll store the URL for notifications.
const port = 8099;
app.listen(port, "0.0.0.0", () => {
  // HA proxies add-on HTTP on http://<host>:<dynamic> or via ingress; since we didn't enable ingress,
  // we reference the internal supervisor hostname + mapped port in message links.
  // The Supervisor maps container port -> a host port automatically. We can’t know it here,
  // so we use HA’s /api/webhook approach instead if you prefer (see Option B below).
  // Simpler: read it from an env var set via S6 or build a HA automation (Option B).
  process.env.ADDON_WEB_URL ||= `http://homeassistant.local:8123/api/webhook/auto-banker-${webhook_secret}`;
  console.log("auto-banker listening");
});

// Start polling
pollLoop().catch(err => console.error(err));
