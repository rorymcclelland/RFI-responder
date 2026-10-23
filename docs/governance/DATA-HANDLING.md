# Data handling and retention

This repository holds synthetic data only (project rule 2). This page describes how a real deployment would hold an organisation's data.

## What data exists and where

All data lives in one Supabase project (Postgres) per organisation. Access rules are in the migrations and tested for every role (decision [0003](../decisions/0003-access-control.md)).

| Data | Table | Who can read | Who can change |
|---|---|---|---|
| Responses (name, owner, due date, outcome) | `opportunities` | Every signed-in member | Owner or admin; archive and delete through functions |
| Uploaded questions, drafts, scores, gates, decisions | `rfi_sessions`, `rfi_questions` | Every signed-in member | Owner, admin or assignee decides; only the server writes scores, gates and drafts |
| Approvals (who accepted what, how, at what threshold, with which models) | `approvals` | Every signed-in member | Nobody (written by a trigger) |
| Knowledge base (questions, answers, provenance, review state) | `kb_entries` | Every signed-in member | Members add; admins edit, review and delete |
| Assignments | `question_assignments` | Assignee, owner, admin | Assignee, owner, admin (work columns only) |
| People (name, job title, expertise, admin flag) | `user_profiles` | Every signed-in member | Themselves (not the admin flag); admins |
| AI usage (who, which model, tokens, estimated cost) | `ai_usage` | Their own rows; admins all | Nobody (written by the Edge Functions) |
| Audit log (exports, archives, deletions, reviews, setting and admin changes) | `audit_log` | Admins | Nobody (written by functions) |

Anonymous visitors can read nothing. Accounts are invite-only.

## What leaves the database

| Sent to | What | When | Configured by |
|---|---|---|---|
| Voyage AI (hosted mode) | Question text; knowledge-base question and answer text | Processing a question; indexing an entry | `EMBEDDING_PROVIDER=voyage` |
| Ollama on the organisation's own machine (local mode) | The same | The same | `EMBEDDING_PROVIDER=ollama` |
| Anthropic (Claude API) | Question text and up to three matched entries (judge, drafter); question text (gate classifier) | Processing a question | `ANTHROPIC_API_KEY` |
| The user's own computer | The exported answers (Excel, CSV, Word) | When the owner downloads them | |

Provider keys are Edge Function secrets and never reach the browser. What each provider does with the data is in [Providers](PROVIDERS.md). Nothing is sent to customers by the tool: the owner exports and sends.

## Retention (agreed 23 October 2026, Sprint 4, Q5)

| Data | Kept | How it ends |
|---|---|---|
| Responses, questions, drafts, approvals | Until an admin deletes a response created in error (archived responses are kept as the record of what was sent) | `delete_response()`, admin only, with a reason, logged |
| Knowledge-base entries | While current; superseded entries are kept for history | Admin delete |
| AI usage records | 13 months | `purge_old_usage()`, callable only by the service role: a hosted deployment schedules it (for example with pg_cron); locally it is run from the database console |
| Daily quota counters and old budget reservations | 7 days; reservations from before last month | The same function |
| Audit log | Indefinitely | Not deleted |

A real organisation would set these against its own records policy; a fixed period for archived responses is a policy choice, not built.
