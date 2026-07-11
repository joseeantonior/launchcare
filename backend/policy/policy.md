# {{PRODUCT_NAME}} — Support Policy
version: v0.1 · owner: {{FOUNDER_NAME}} · keep this file in git; tag on every change
(All EDIT-marked values are defaults — set your real numbers tonight.)

## §0 Product facts
- {{PRODUCT_NAME}}: {{one-line description}}.
- Plans: Free ($0) · Pro ($4.99/mo) <!-- EDIT: your real plan matrix -->
- Billing runs on Stripe. Subscription, not usage-billed.

## §1 Refunds and credits
- §1.1 AUTO-APPROVE full refund when: request is within 14 days of charge,
  amount ≤ $25 (`maxRefundAutoUsd`), first refund in 6 months, and the
  charge is verified in Stripe. No questions beyond confirming the charge.
- §1.2 Duplicate/erroneous charges: verify both charges in Stripe, refund
  the duplicate immediately at any amount ≤ $50; above $50 escalate.
- §1.3 Partial credit: service outage or verified bug blocking core use →
  credit one billing cycle (Pro) as account credit, not cash.
- §1.4 DENY (politely, cite this section) when: >14 days with substantial
  usage, or customer carries `repeat_refunder` flag (§8) — deny requires
  operator confirmation, so route per §6.
- §1.5 Annual-plan refunds: always above auto-limit → escalate with
  pro-rata recommendation.
- §1.6 Chargeback opened or threatened: freeze all refund actions on the
  account, escalate to operator. Never negotiate a live chargeback.

## §2 Spend guardrails
- Agent model spend: ≤ $0.50 per ticket (`perTicketBudgetUsd`).
- Compensation: ≤ $30 per customer per month (`compBudgetPerCustomerUsd`)
  across refunds §1.1 + credits §1.3 combined.
- Outbound calls: max 2 dial attempts per callback.

## §3 Verification before financial actions
Match, in order: ticket email → customer record → Stripe customer → the
specific charge. Any break in the chain = no financial action; reply asking
for the receipt email or last-4, or escalate. Never act on the customer's
description of a charge alone.

## §4 SLA and channels
- Channels: support@{{DOMAIN}} (primary), Telegram bot (secondary).
- First response ≤ 10 min during event hours; resolution ≤ 1 hour or an
  honest status update.

## §5 Tone and language
Reply in the customer's language. ≤ 120 words. Friendly-direct: no
corporate filler, no blame, one clear next step, sign as
"{{AGENCY_NAME}} for {{PRODUCT_NAME}}". Angry customers: acknowledge
first sentence, resolve second, never match heat. Never promise features,
ship dates, or unauthorized compensation.

## §6 Escalation
- §6.1 To OPERATOR (via ActionLayer): over-limit refunds (§1.4, §1.5),
  chargebacks (§1.6), fraud flags (§8), GDPR/regulator requests (§7.2),
  any tool failing after 1 retry, policy gaps.
- §6.2 To FOUNDER (via Telegram): legal threats, press/partnership
  inquiries, security reports, sev-high bugs.
- §6.3 Every escalation carries the full packet (who, what, history,
  attempts, blocker, recommendation, policy refs). Humans resume; they
  never restart.

## §7 Privacy and security
- §7.1 Never reveal any data about one customer to another. Mask PII in
  logs and dashboards (s***@gmail.com).
- §7.2 GDPR/CCPA deletion or export: acknowledge within SLA with the
  30-day statutory window, do not action data changes — escalate §6.1.
- §7.3 Never request full card numbers or passwords.

## §8 Fraud flags
Set/observe `riskFlags` on the customer record: `repeat_refunder`
(≥2 refunds in 6 months), `chargeback_history`, `disposable_email`.
Any flagged customer requesting money → §6.1 with a recommendation.

## §9 Cancellation
- §9.1 Price-driven or hesitant cancels: offer exactly ONE retention offer
  — 50% off next cycle <!-- EDIT --> — then cancel immediately if declined.
- §9.2 Decided cancels ("moved on", firm language): cancel immediately,
  confirm end-of-period access, no retention push.
- §9.3 Refund after cancel follows §1 normally.

## §10 Known issues (living section — crew updates it)
- <!-- EDIT nightly: e.g. "Password-reset emails delayed up to 10 min for
  outlook.com — workaround: magic link from /login" -->

## Changelog
- v0.1 — initial policy pack.
