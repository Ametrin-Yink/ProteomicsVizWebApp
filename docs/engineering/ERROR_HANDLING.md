# Error handling and recovery

Errors must preserve data, provide an actionable user message, and leave the workflow in a state that can be inspected or retried.

## Classification

| Class | Example | Expected behavior |
|---|---|---|
| Validation | Missing vendor column, invalid comparison | Reject before work starts and identify the field/input |
| Configuration | Incomplete metadata or channel mapping | Block processing and preserve entered state |
| Processing | DuckDB, Python, or R stage failure | Persist failed stage/log context and allow a valid retry |
| Resource | Timeout, memory, disk exhaustion | Stop bounded work, preserve evidence, notify operator |
| External | Biomart/network unavailable | Use the documented fallback or return a clear dependency error |
| Integrity/security | Path escape, corrupt state, invalid capability | Fail closed without exposing paths, tokens, or report existence |

## Frontend behavior

- Normalize API failures through existing client/error utilities rather than inventing per-component formats.
- Show specific, actionable messages and retain technical detail in logs or expandable diagnostics.
- Always clear loading state in `finally` or equivalent cleanup.
- Abort requests on unmount/scope change and prevent stale results from replacing current state.
- An errored or cancelled workflow must have a navigation path back to configuration/session management.
- Shared pages must not reveal private controls or whether an internal report exists.

## Backend behavior

- Validate at the earliest authoritative boundary.
- Keep route handlers thin and translate expected domain errors through established FastAPI handlers.
- Move blocking I/O/subprocess work off the event loop.
- Persist session/pipeline state before surfacing a processing failure.
- Log session ID, stable stage name, and safe diagnostic context; never log bearer tokens or sensitive file contents.
- Clean unpublished report staging directories after generation failure. An incomplete report must never become visible.

## Recovery

Pipeline retry is a clean replay from stage 1. It accepts an errored session, revalidates inputs/configuration, clears prior attempt state, and schedules the registered pipeline while preserving uploads. True mid-stage resume is not supported.

At startup, interrupted processing/tasks are reconciled to an inspectable error state rather than assumed to still be running. Derived shared-report tasks left `running` without a matching task are marked failed so a protein-report recipient can retry them.

Report token rotation makes the old link return the same 404 as an unknown token. Source-session deletion must not affect an already published snapshot.

## User messages

Messages should say what failed, where it failed, what the user can do, and whether data was preserved. Avoid promising retry when configuration/artifact compatibility prevents it. Never expose absolute server paths, stack traces, environment variables, internal report IDs, or capability lookup details to shared recipients.
