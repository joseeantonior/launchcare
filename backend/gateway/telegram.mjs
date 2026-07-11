// Telegram ingress via long-polling — no public HTTPS/domain/open port
// needed on the box. Started by index.mjs when TELEGRAM_TOKEN is set.
// Every text message becomes a ticket; the crew's reply goes back to the
// chat. ponytail: one chat message = one ticket; threaded conversations
// ride on customerContext (same pseudo-email) until real sessions matter.

const BASE = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";

export function startTelegram({ token, onTicket }) {
  const api = async (method, params) => {
    const res = await fetch(`${BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    return await res.json();
  };

  async function handle(msg) {
    const result = await onTicket({
      source: "telegram",
      channelRef: String(msg.chat.id),
      customerEmail: `tg-${msg.from?.id ?? msg.chat.id}@telegram.local`,
      subject: msg.text.slice(0, 80),
      body: msg.text,
    });
    await api("sendMessage", {
      chat_id: msg.chat.id,
      text: result.customerReply ?? result.summary ??
        "We're on it — you'll hear back shortly.",
    });
  }

  let offset = 0;
  let fails = 0;
  async function poll() {
    try {
      const updates = await api("getUpdates", { offset, timeout: 25 });
      fails = 0;
      for (const u of updates.result ?? []) {
        offset = u.update_id + 1;
        if (u.message?.text)
          handle(u.message).catch((e) => console.error("telegram handle:", e.message));
      }
    } catch (e) {
      // Single blips are routine (Telegram closes kept-alive sockets between
      // long polls); retry fast, and only log when failures persist.
      fails++;
      if (fails >= 3)
        console.error(`telegram poll: ${fails} consecutive failures:`,
          e.message, e.cause?.code ?? e.cause?.message ?? "");
      await new Promise((r) => setTimeout(r, Math.min(fails * 2000, 10000)));
    }
    poll();
  }
  poll();
  console.log("telegram poller started");
  return { api }; // reusable for outbound (founder escalations) later
}
