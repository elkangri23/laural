# Preference Sync and Profile Portability

* **Author:** Antonio Moles
* **Date:** 2026-11-21
* **Status:** EGM brainstorm and design draft complete; author-approved. Ready for implementation planning.

## Overview

Laural should remain fully usable without an account. Anyone can export preferences and import them on another device without signing in or using a Laural service. People who choose to sign in get the additional convenience of automatic synchronization for a small, explicitly defined set of application preferences and provider-profile metadata. API keys, account credentials, conversations, terminal history and project content stay outside cloud sync. In the separate manual export/import flow, API keys may be included only inside a password-protected encrypted file.

The first sync service is planned for the author's VPS at `sync.laurafernandezenfermeria.com`, implemented with TypeScript, Fastify and PostgreSQL. The client checks for remote changes every three hours while Laural is open; locally saved configuration changes are also synchronized automatically, and Settings provides **Sync now**. A public, unauthenticated status page will show service availability, incident notices and maintenance updates without exposing user data. The service is assumed to use TLS and encryption at rest, but not end-to-end encryption; the operator can therefore read the allowed sync payload. Custom provider endpoints are excluded unless the user opts in for that profile. This is a material privacy boundary, not a cryptographic guarantee against the operator.

## Problem Statement

Laural stores preferences across several local stores. Manual export/import provides an account-free way to move a snapshot between devices, but it does not provide account-based automatic updates. Optional account sync adds that convenience while introducing identity, hosting, recovery, privacy and data-loss risks that do not exist in local-only use. People who do not want an account must still be able to transfer settings without a service dependency.

## Anchored Working Hypothesis

From Settings, the user can sign in and start synchronization. Laural reads the local and cloud snapshots. If the cloud has never been initialized, the first upload requires an explicit user choice. If both snapshots exist and differ, it asks which whole snapshot to keep without listing field-level changes. The prompt identifies the side that will be replaced, and Laural creates a recoverable local or cloud copy before replacement.

After sync is enabled, each successfully saved settings change is saved locally first and then synchronized automatically. Settings also offers **Sync now**. Offline changes remain on the device and are queued. On reconnect, Laural uploads only when the cloud revision still matches the last revision the device acknowledged; if both sides changed, it pauses and asks which whole snapshot to keep. It never silently overwrites a newer revision.

## Analysis

### What the Goldfish Review Found

Seven reviewers completed fresh-context reviews of the concept, current plan, related ADRs, security documents and project context.

1. **The no-diff overwrite choice can cause accidental loss.** A user cannot tell whether choosing local or cloud discards provider profiles, custom endpoints or other useful preferences. The author approved a generic prompt that names the side being replaced and says a recoverable copy will exist; field-level values will not be shown.
2. **The current documents promise a different UX.** The existing plan describes a differences preview, merge and field-level conflict resolution. The concept now calls for a simple whole-snapshot choice without listing changes. The formal plan and ADR-0020 must be aligned with the chosen contract before implementation.
3. **The hosted service has an owner, but operating limits remain.** The author plans to host it on their VPS and has decided not to keep disaster-recovery copies outside that VPS. Total host loss may permanently erase accounts and cloud preferences. Identity, transactional email, account recovery, abuse handling, deletion, incident response and support still create ongoing work. Payload storage is likely small, but sync frequency, account/device limits, retries and service costs remain undefined. The strongest counterargument is that encrypted manual export already covers one-time device transfer without this service burden.
4. **Local settings do not live in one store.** Current preferences are split across WebView `localStorage`, `providers.json`, `agent.json` and Windows Credential Manager. A versioned allowlist and adapters are needed; a generic “sync all settings” mechanism would couple remote sync to unrelated stores and could accidentally include agent permissions or credential references. The author explicitly chose to exclude agent settings.
5. **Conflicts and failures need fail-closed behavior.** Empty, unavailable, corrupt, partial and newer-unsupported cloud states must not be treated as an empty account. Uploads need revision-conditional and idempotent behavior; local saves must succeed even if remote sync fails. Offline pending state must survive restart, remain bounded and visible, and not be confused with a completed sync.
6. **The no-E2EE service must minimize and disclose data.** TLS and server-side encryption do not prevent operator access. Custom endpoints may expose internal infrastructure, so they should require explicit per-profile consent. Retention, staff access, deletion from backups and breach handling need an owner and policy.
7. **Observability must not copy the payload.** Support can use stable error categories, status, timing, schema/client versions and opaque operation IDs. Logs, traces and user-submitted diagnostics must exclude payloads, diffs, emails, endpoints, credentials, tokens, IP addresses and raw exception text. Diagnostics should be user-initiated, sanitized and previewed.
8. **Authentication breadth is part of v1 by author decision.** The first sync release must support email/password, Google, passkeys and MFA/TOTP. Account recovery also needs a six-digit, single-use email PIN that expires after five minutes. The author chose this PIN for email verification and recovery only, never for normal sign-in or as an MFA alternative. It must be rate-limited, stored only as a verifier, excluded from logs, and must not silently disable existing MFA. If all enrolled factors are lost, the user contacts the project administrator (the author), who evaluates the case using independent evidence and decides whether to remove the lost MFA/passkeys. The PIN proves mailbox access only and cannot by itself justify factor removal. The request, decision, notification and audit procedure must be documented and logged without secrets.
9. **Indefinite snapshots need explicit lifecycle rules.** The author requested that local and cloud recovery copies never expire automatically. If every ordinary setting save creates a permanent cloud snapshot, a small settings payload can still accumulate without bound. Define which destructive operations create a snapshot, how users inspect/delete snapshots, quotas or storage caps, and whether account deletion erases all cloud copies.

### Existing Codebase Context

- `providers.json` stores provider metadata and stable profile IDs; provider API keys are stored separately using Windows Credential Manager through `keyring`.
- `agent.json` stores agent execution policy. It can change what commands Laural is allowed to run and should remain excluded from initial sync unless explicitly approved as a separate scope.
- WebView `localStorage` holds appearance and update preferences. There is no unified profile snapshot, sync client, account backend or auth subsystem today.
- Existing code uses Rust/Tauri commands, bounded serde inputs, generic user-safe errors, and a small local activity log with enumerated fields. These boundaries are candidates for reuse; the local activity log should not become a remote telemetry stream.

## Goals vs. Non-Goals

### In-Scope Goals

- Keep terminal and local configuration usable without an account or network connection.
- Keep manual export/import available without signing in; preference transfer must not depend on the account service.
- Allow an optional account to sync an allowlisted set of preferences and provider metadata.
- Exclude API keys and authentication secrets from cloud payloads permanently.
- Exclude chat, terminal history and commands, project files, project paths and local activity from sync.
- Keep custom provider endpoints out by default and require explicit consent before uploading them.
- Remember custom-endpoint consent per provider profile so approval for one profile does not expose others.
- Ask before the first upload, replacement or conflict resolution; do not silently overwrite another revision.
- Synchronize a successfully saved local change automatically after login and provide **Sync now**.
- Keep manual export/import distinct from cloud sync; export keys only with mandatory password-based authenticated encryption.

### Out-of-Scope Non-Goals

- End-to-end encryption in the first hosted-sync release.
- Syncing API keys, passwords, OAuth tokens, passkeys, conversations, terminal output, commands, files, projects or paths.
- Making an account or service mandatory for using Laural.
- Requiring an account for a one-time or occasional device transfer.
- A general-purpose synchronization engine for arbitrary future data.
- Field-level merge in the first version unless the author explicitly changes the whole-snapshot conflict contract.
- Syncing agent execution mode or allow-rules; the author chose to exclude them because they can transfer execution permissions.

## Alternatives Weighed

- **Local-only configuration:** simplest and protects privacy, but does not support recurring multi-device updates. Keep it as the default mode and guaranteed fallback.
- **Manual export/import without an account:** always available for one-time or occasional transfer and does not require Laural hosting. It requires a user action for each transfer and does not reconcile devices automatically. It remains a complete account-free path, not a degraded or temporary mode.
- **User-managed cloud drive/file sync:** avoids operating Laural identity and backend, but leaves file conflicts, device access, deletion and secret protection to the user and storage provider. It does not provide a controlled sync contract.
- **First-party hosted sync with server-readable preferences:** supports account recovery and straightforward device access; costs ongoing service operations and lets the operator read the allowed payload. The author plans to host the official service on their VPS.
- **End-to-end encrypted sync:** prevents the service operator from reading the payload, but adds encryption-key recovery, device enrollment and account-recovery complexity. Deferred unless operator confidentiality is a non-negotiable requirement.
- **Detailed diff and field-level merge:** preserves selected changes but expands UI, schema migration, testing and conflict semantics. The author chose whole-snapshot choices without field-level diffs; the accidental-loss risk is addressed by a generic replacement warning and recoverable copy before replacement.
- **Phased sign-in methods:** adding email/password, Google, passkeys and TOTP across multiple releases reduces initial delivery scope but delays requested access methods and creates a partial-auth period to support. The author chose to require all four capabilities in the first sync release.

## Risks and Required Constraints

- Never treat timeouts, parse errors, partial reads, corrupt data or unsupported newer schemas as an empty cloud profile.
- Version the sync allowlist; reject unknown required fields and preserve local-only stores. Do not send local credential references or agent policy by accident.
- Save locally before remote work. Persist pending sync state and the last acknowledged cloud revision; retry with bounded backoff and coalesce repeated saves.
- Use conditional/idempotent writes. A lost response must not cause a stale retry to overwrite newer cloud state.
- Back up all local stores affected by a replacement and provide a clear restore path. Local and cloud recovery copies do not expire automatically; create them before whole-snapshot replacement/conflict resolution rather than on every ordinary settings save. Credential Manager data must not be copied into ordinary backups.
- Use a payload-free observability allowlist: event category, result category, duration, attempt number, schema/client version and opaque operation ID. Keep diagnostic upload opt-in and previewed.
- Define request and payload limits, account/device limits, retry behavior, deletion verification, recovery, revocation and service shutdown/export before service launch. Snapshot expiry is disabled by author decision; define snapshot creation events and deletion controls instead.
- Keep account sync optional and keep local work functional through service outages and account deletion.

## Key Decisions & Staging for Next Steps

### Decisions currently anchored by the author

- Sync app preferences and provider configuration, but never API keys or login secrets.
- Keep local-only usage available without an account.
- Preserve export/import as a full account-free way to transfer settings, independent of whether hosted sync is ever enabled.
- Operate the official synchronization service on the author's VPS.
- Use TypeScript, Fastify and PostgreSQL for the first service implementation.
- Publish the official API at `https://sync.laurafernandezenfermeria.com`.
- Provide a public unauthenticated status page on the sync domain for high-level availability, incident updates and maintenance notices.
- Serve the status page statically from the same VPS at `/status`; it survives an API/database process failure but not total VPS/network loss.
- Provide email/password, Google, passkey and MFA/TOTP sign-in in the first sync release.
- Exclude agent mode and rules from synchronization.
- Require custom-endpoint opt-in per provider profile.
- Sync appearance/theme, update preference, provider type/name/model and active profile; sync custom endpoints only after per-profile consent.
- Never expire recovery snapshots automatically; create them before whole-snapshot replacement/conflict resolution, not on every ordinary save. Account deletion removes cloud data and cloud snapshots; local copies remain on devices.
- Show a generic replacement warning and say a recoverable copy will be made; do not show field-level differences.
- If the cloud is empty at first login, ask once before uploading the local snapshot and enabling auto-sync.
- Provide email account-recovery PINs with six digits, one use, and five-minute expiry.
- Use the email PIN only for address verification and recovery, never as a passwordless login or substitute MFA factor.
- If a user loses every enrolled factor, route recovery to manual review by the project administrator, who applies independent judgment. Factor removal is never automatic; the email PIN proves mailbox access only.
- Check for cloud changes every three hours in addition to automatic sync after successfully saved local changes and the user-triggered **Sync now** action.
- Run the three-hour check only while Laural is open; when the app starts or resumes, check current cloud revision and resume pending work. Do not install a Windows background service for closed-app checks in the first release.
- On first sync or conflict, ask which whole snapshot to keep without a detailed field diff; back up before replacing.
- After login, automatically sync saved configuration changes and expose **Sync now**.
- Do not apply silent last-write-wins when both local and cloud revisions changed.
- Start without E2EE, with clear disclosure that the operator can read allowed sync data.
- Exclude private endpoint URLs by default; require explicit opt-in.
- Keep chats, terminal history/commands and project data out of cloud sync.
- API keys in manual transfer require a password-protected encrypted file; no plaintext-key export.

### Decisions still open

- Define VPS payload/device/request-rate limits, recovery-snapshot deletion controls and service monitoring before production deployment. Disclose that the owner has ruled out off-VPS disaster backups and total host loss may erase cloud data.
- Write the administrator recovery runbook and its independent evidence checklist before enabling factor removal; notify the user and record each decision without logging sensitive evidence.

### Proposed Staging

1. Align the existing synchronization plan and ADR-0020 with the approved no-diff flow and data boundaries.
2. Implement account-free export/import first; API keys remain encrypted-only.
3. Build and deploy the optional VPS service, browser authentication and public status page.
4. Implement desktop account sessions, preference sync, conflict handling, endpoint consent and offline recovery.
5. Complete the account-recovery, deletion, status-page and incident-response runbooks before opening registration. Record the accepted no-off-VPS-backup decision and disclose its data-loss consequence.

## Goldfish Reviewer Status

| Lens | Status |
| --- | --- |
| Design / architecture and infrastructure economics | Completed |
| Codebase details / observability | Completed |
| Zoom-out / YAGNI and reuse | Completed |
| Comprehension / UX | Completed |
| Migration and compatibility | Completed |
| Structural / maintainability | Completed |
| Inventive catalyst | Completed |
