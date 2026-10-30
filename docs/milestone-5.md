# Milestone 5: demo and submission readiness

Verified October 30, 2026 (America/Denver).

This document records the completion of Milestone 5: repository verification, clean installation from README instructions, fresh operator setup, demo rehearsal procedures, and submission readiness.

## Fresh checkout verification

A fresh checkout was tested in an isolated temporary directory cloned from `origin/main` without relying on any pre-existing local files, cached credentials, or generated artifacts:

1. **Clean workspace**:

   ```sh
   git clone https://github.com/mastroevan/patch-party.git /tmp/patch-party-fresh
   cd /tmp/patch-party-fresh
   ```

   Confirmed the clone contains only tracked files: no `.env`, no `.local/`, no `node_modules/`, no `dist/`, and no local generated rule artifacts.

2. **Installation (`npm install`)**:

   ```sh
   npm install
   ```

   Resolved in 3 seconds, installing 93 packages with 0 vulnerabilities.

3. **HTTPS setup (`npm run setup:https`)**:

   ```sh
   npm run setup:https
   ```

   Generated local development certificates in `.local/https/` (`localhost.pem` and `localhost-key.pem` with restrictive `0600` permissions) without altering system certificate trust stores.

4. **Production build (`npm run build`)**:

   ```sh
   npm run build
   ```

   TypeScript typechecking (`tsc --noEmit`) and Vite production bundling completed with 0 errors.

5. **Automated tests**:
   - `npm test`: All **56** unit and integration tests passed across coordinator lifecycle, QuickJS WebAssembly sandboxing, AST validation, Twitch OAuth/EventSub, state persistence, and operator recovery.
   - `npm run test:e2e`: All **6** Playwright browser tests passed, covering operator authentication, OBS overlay isolation, gameplay, preview, activation, revert, and restart recovery.
   - `npm run prove-codex:saved`: Offline validation of baseline artifacts verified 78 trusted behavioral scenarios and QuickJS determinism replay.

6. **Operator login and configuration**:
   - Starting the server without configuration generates a random 43-character base64url operator key printed to stdout:
     `Patch Party operator: https://127.0.0.1:5173/#operator=<key>`
   - Accessing the printed link automatically logs into the operator session and strips the key fragment from browser history.
   - Direct visits without the key display the password gate (`OperatorGate`).
   - `/api/operator/session` rejects unauthorized keys with HTTP 401 and issues secure, HTTP-only session cookies upon valid login.
   - Copying `.env.example` to `.env` loads configuration cleanly, allowing custom `PATCH_PARTY_OPERATOR_KEY` and Twitch credentials without committing secrets.

## Complete live demo rehearsal guide

Rehearse the complete demonstration using the following sequence:

```
[01 · Twitch Proposal] ──> [02 · Live Voting] ──> [03 · Codex Generation]
                                                          │
[06 · Arena Gameplay]  <── [05 · Activation]  <── [04 · QuickJS Checks]
      │
      ├──> [Preview / Inspect Evidence]
      ├──> [Revert to Original Physics]
      └──> [Streamer Recovery: Saved Rule / Skip]
```

### 1. Pre-stream setup

- Set up OBS with two sources:
  - **Window Capture**: Streamer game window at `https://127.0.0.1:5173`.
  - **Browser Source**: Read-only overlay at `https://127.0.0.1:5173/overlay` (transparent, 1920x1080).
- Verify Twitch connection status displays **Twitch chat connected** in the control room.

### 2. Proposal phase

- In the lobby, switch the **Rule Engine** dropdown to **Live Codex**.
- In chat, have viewers nominate rules: e.g. `!rule every second coin flips gravity for 2 seconds` or `!rule sprint`.
- Click **Start round**.

### 3. Voting phase

- While the streamer plays the 45-second arena, viewers vote with `!vote 1`, `!vote 2`, or `!vote 3`.
- Ballot counts and voter badges update live on both the streamer view and the OBS overlay.
- Click **Lock vote** (or let the round timer complete).

### 4. Codex build & isolated validation

- The winning proposal enters the 4-stage pipeline:
  `01 · Chat chose` → `02 · Codex builds` → `03 · Checks` → `04 · Ready`.
- Real Codex execution writes the JavaScript module in a sandboxed worker.
- Isolated QuickJS WebAssembly worker validates:
  - Pure synchronous function with restricted language surface (AST checks).
  - 78 deterministic behavioral scenarios.
  - Command bounds, magnitude, and duration limits.
- Click **Inspect generated code & validation evidence** to show the SHA-256 hash, SDK thread ID, and timings.

### 5. Preview & activation

- Click **Preview next rule**: inspect simulated coin collection and command outputs without modifying active gameplay.
- Click **Play next round →**:
  - A 3-second patch reveal card introduces the rule and credits the winning Twitch viewer.
  - Round starts with the exact generated module active in the arena.

### 6. In-game verification, revert, and recovery

- Collect coins: verify the rule executes (e.g. gravity flip with HUD alert).
- Click **Revert to original**: physics immediately return to classic rules, preserving the round timer and score.
- Demonstrate recovery controls:
  - **Use saved rule · library**: loads and re-validates a baseline rule from disk if generation is skipped or failed.
  - **Skip rule · play original**: falls back cleanly to house rules.

## Submission package

- **Repository**: Public GitHub repository with clean history.
- **Secret exclusion**: `.gitignore` excludes `.env`, `.local/`, and local runtime files.
- **Proof artifacts**:
  - Milestone 2 live generation evidence and screenshot in `docs/milestone-2/`.
  - Milestone 3 Twitch EventSub architecture and live acceptance guide in `docs/milestone-3.md`.
  - Milestone 4 operator recovery guide and preview screenshot in `docs/milestone-4.md`.
  - Milestone 5 checkout verification and live rehearsal guide in `docs/milestone-5.md`.
