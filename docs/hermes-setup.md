# Hermes setup — ELI5, on the tenant box

Make [Hermes Agent](https://hermes-agent.nousresearch.com) the brain behind
your gateway. After this, every channel (Telegram, HTTP) is answered by
your Hermes agent; the built-in Novita loop stays available as a fallback
(`RUNNER` unset).

Do everything below **as the user the service runs as** (e.g.
`joseeantonior`, per your systemd unit) — Hermes keeps its state in that
user's `~/.hermes/`. Total time: ~15 minutes.

### Step 1 — Install Hermes (2 min)

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes --version
which hermes        # note this path — you may need it in step 5
```

### Step 2 — Point Hermes at Novita (3 min)

Hermes supports custom OpenAI-compatible providers. Edit `~/.hermes/config.yaml`
(`hermes config edit`) and add:

```yaml
custom_providers:
  novita:
    base_url: "https://api.novita.ai/openai/v1"
    api_key_env: "NOVITA_API_KEY"

model:
  provider: novita
  model: pa/claude-opus-4-8-cc   # the manager's tier; same partner ids as the crew
```

And put the key in `~/.hermes/.env`:

```
NOVITA_API_KEY=<the same key as in launchcare/backend/.env>
```

### Step 3 — Create the LaunchCare profile (2 min)

The profile's `SOUL.md` is the manager system prompt + your live crew
roster, rendered from Convex (re-run this after any crew or policy change):

```bash
cd ~/launchcare/backend
set -a; source .env; set +a     # loads ORG_ID + CONVEX_URL
node scripts/render-hermes-profile.mjs
# → wrote ~/.hermes/profiles/launchcare/SOUL.md  (4 roles, agency "…")
```

### Step 4 — Smoke test by hand (2 min)

```bash
hermes -p launchcare --yolo -z "In one sentence: what is your job and who is on your crew?"
```

You should get an answer in the manager's voice naming the specialists. If
it answers like a generic assistant, the profile didn't load — check that
Step 3 wrote to `~/.hermes/profiles/launchcare/SOUL.md`.

### Step 5 — Flip the gateway to Hermes (2 min)

```bash
nano ~/launchcare/backend/.env
```

Add/uncomment:

```
RUNNER=hermes
# Only if `which hermes` (step 1) printed somewhere systemd won't find:
# HERMES_BIN=/home/joseeantonior/.local/bin/hermes
# HERMES_PROFILE=launchcare   # default already
```

```bash
sudo systemctl restart launchcare
journalctl -u launchcare | tail -2   # gateway up on :8787
```

### Step 6 — Prove it end-to-end (2 min)

Message your Telegram bot, or:

```bash
curl -X POST localhost:8787/tickets -H 'Content-Type: application/json' \
  -d '{"customerEmail":"test@example.com","subject":"How do I export my data?","body":"Zip or CSV?"}'
```

Then open Operations in the app: the run's trace steps were logged **by
Hermes itself** (it curls `agency:logStep` per its kickoff instructions),
and the final envelope came from its answer. That's the qualifying shape:
Hermes is the agent; the gateway is just channels + records.

### Step 7 — Qualification receipts

Every run is a Hermes session in the `launchcare` profile:

```bash
hermes -p launchcare sessions list
hermes -p launchcare sessions export   # keep these — your Hermes receipts
```

### How it works / troubleshooting

- The gateway invokes `hermes -p launchcare --yolo -Q -z "<kickoff>"` per
  ticket ([gateway/runner-hermes.mjs](../backend/gateway/runner-hermes.mjs)
  — the only Hermes-specific file). `--yolo` is required: headless runs
  can't answer approval prompts.
- The kickoff carries the five context blocks (ticket, customer memory,
  policy, roles, settings) plus that run's exact trace-logging curl.
- The FINAL envelope must be the last JSON object in Hermes's answer — the
  runner scans for it; no envelope ⇒ run marked failed (visible in Alerts).
- Runs are capped at 5 minutes; a hung Hermes is killed and the run fails
  cleanly.
- `spawn hermes ENOENT` in the journal ⇒ systemd can't find the binary ⇒
  set `HERMES_BIN` to the full path from `which hermes`.
