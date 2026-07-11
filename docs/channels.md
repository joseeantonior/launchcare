# Channels — how customers reach your agent

The gateway on your box is the front door. Today: **Telegram** (working) and
**direct HTTP** (working). Email and phone are next — see
[architecture.md](architecture.md).

With `RUNNER=hermes` set on the box, every one of these channels is talking
to your **Hermes agent** — the channel plumbing is identical; only the brain
changes ([gateway.md](gateway.md) → Runners).

---

## Telegram — ELI5, ~5 minutes

You'll create a bot, give its key to your box, restart. No domain, no
HTTPS, no open ports — the box polls Telegram outbound, so this works on a
bare Linode behind any firewall.

### Step 1 — Create your bot (2 min, on your phone or desktop Telegram)

1. In Telegram, search for **@BotFather** (blue checkmark) and open it.
2. Send it: `/newbot`
3. It asks for a display name → type e.g. `Acme Notes Support`.
4. It asks for a username → must end in `bot`, e.g. `acmenotes_support_bot`.
5. BotFather replies with a **token** like
   `7712345678:AAHfake-tokenExampleXYZ`. Copy it — that's the bot's key.

### Step 2 — Give the token to your box (2 min)

SSH into the tenant's Linode and add the token to the gateway's `.env`:

```bash
nano /home/joseeantonior/launchcare/backend/.env
# find the TELEGRAM_TOKEN= line and paste:
# TELEGRAM_TOKEN=7712345678:AAHfake-tokenExampleXYZ
systemctl restart launchcare
journalctl -u launchcare | tail -3   # you should see: "telegram poller started"
```

### Step 3 — Talk to your agent (1 min)

1. In Telegram, search for your bot's username (`@acmenotes_support_bot`),
   open the chat, press **Start**.
2. Send it a real support message: *"I was charged twice this month"*.
3. The crew runs the full loop — triage, plan, verify, QA — and **the reply
   arrives in the chat**. Open your ops view (app home → Operations): the
   run and its full trace tree are there, source `telegram`.

That's it. Every message to the bot becomes a ticket; every reply comes
from the crew (or your Hermes agent, if `RUNNER=hermes`).

### How it works / limits (honest notes)

- The gateway **long-polls** `getUpdates` — that's why no webhook, domain,
  or certificate is needed.
- Chat users get a pseudo-identity (`tg-<userid>@telegram.local`) so
  customer history/memory works across their messages.
- One message = one ticket. Follow-ups in the same chat land as new tickets
  with the same identity — the crew sees the history (that's eval case T18's
  behavior).
- One bot per tenant box. Don't reuse a token across boxes — two pollers on
  one token steal each other's updates.
- Keep the token secret: anyone with it can read/impersonate the bot.

## Direct HTTP (for your own integrations)

```bash
curl -X POST http://<box>:8787/tickets -H 'Content-Type: application/json' \
  -d '{"customerEmail":"user@example.com","subject":"Locked out","body":"..."}'
```

Returns the final envelope (`action`, `summary`, `runId`). Port 8787 is
plain HTTP — keep it firewalled to your own services, or front it with
nginx + certbot if something external must call it.

## Coming next

- **Email**: per-tenant forwarding address → inbound webhook → same ticket
  flow.
- **Phone**: ElevenLabs outbound (voice_caller) + a callback number.
- **Founder escalations over Telegram**: outbound alerts to *your* chat when
  the crew escalates (the poller module already exposes the send API).
