# Patch Party

**Chat invents the rules. The streamer plays them.**

Milestones 1–4 are implemented. Live Twitch/OBS verification was confirmed by the streamer:

- **Milestone 1**: Playable 45-second platform arena, simulated community chat, server-managed ballots, and three trusted sample mechanics.
- **Milestone 2**: Live Codex rule builder pipeline (`Chat chose → Building → Checking → Ready`), isolated QuickJS WebAssembly rule runner with strict language & memory boundaries, real Codex SDK execution worker, evidence inspection (thread ID, SHA-256 hash, duration, AST/determinism checks, source code), and streamer recovery controls (retry, cancel, skip, library fallback).

- **Milestone 3**: Twitch broadcaster OAuth, read-only EventSub chat, reconnect/keepalive recovery, token rotation/revocation, authenticated operator controls, connection health, a read-only OBS overlay, and a live-test evidence report. [Setup and live acceptance guide](docs/milestone-3.md).
- **Milestone 4**: Isolated preview, immediate revert, persistent credited rule library, clean lobby recovery, clearer viewer instructions, optional sound cues and reduced-motion support. [Operator recovery guide](docs/milestone-4.md).

## Run locally

Requires Node.js 22.12+ and npm. Live generation also requires working Codex authentication (`codex login`). The SDK installs a matching CLI; a separate global CLI is optional.

```sh
npm install
npm run setup:https
npm run dev
```

Open the **operator link printed in your terminal** to unlock the controls. The key disappears from the address bar after sign-in. A direct visit to https://127.0.0.1:5173 displays the operator login. The local state server listens on 127.0.0.1:3001. Both ports must be available. Keep the terminal running; Ctrl+C stops both processes.

For Twitch, copy `.env.example` to `.env`, fill in the client ID and secret for a **Confidential** Twitch application, and restart the server. Register `https://127.0.0.1:5173/api/twitch/callback` as the exact redirect URI. Then click **Connect Twitch** in the control room. The app reads viewer commands without sending bot replies. The [Twitch/OBS guide](docs/milestone-3.md) covers registration, broadcaster consent, OBS setup, and the two-viewer live test.

OBS uses https://127.0.0.1:5173/overlay for a transparent, read-only Browser Source. This page contains no game simulation and cannot become the controller. Capture the game from the operator browser window using OBS Window Capture. Twitch tokens and private runtime data stay in ignored `.local/`.

### Trying Live Codex Mode

1. In the lobby, switch the **Rule Engine** dropdown to **Live Codex**.
2. Nominate a rule with simulated chat: e.g. `!rule every second coin flips gravity for 2 seconds`, or pick standard candidates like `!rule gravity`, `!rule moon`, or `!rule sprint`.
3. Click **Start round**, then focus the arena to move with A/D and jump with Space/W.
4. Viewers vote with `!vote 1`, `!vote 2`, or `!vote 3`.
5. Lock the ballot (`Lock vote`) or let the round finish.
6. The Rule Workshop initiates generation and validation:
   - Pipeline stages: `01 · Chat chose` → `02 · Codex builds` → `03 · Checks` → `04 · Ready`.
   - Checks are run in isolated QuickJS workers across 78 trusted behavioral scenarios and determinism replays.
   - If credits or API access are depleted, the streamer can click **Use saved rule · library** to load and verify a baseline artifact from `artifacts/baselines/` (or a previously generated artifact from `artifacts/rules/`), or **Skip rule · play original** to fall back to classic physics.
7. Once ready, click **Inspect generated code & validation evidence** to review the artifact's SHA-256 hash, thread ID, generation timing, and isolated checks.
8. Click **Play next round →**. A 3-second patch reveal introduces the generated rule, and the new round starts with the exact generated module active in the arena!

## Codex Technical Proof

To run the standalone technical proof script:

```sh
npm run prove-codex
```

This requires a real live generation and validates the accepted coin/gravity rule in the isolated QuickJS worker, printing its SHA-256 hash, runtime thread ID, timings, and checks. It exits unsuccessfully if generation fails; saved rules cannot satisfy this proof.

The restricted worker prefers the desktop runtime when `CODEX_APP_RUNTIME_CLI_PATH` is available, otherwise the matching CLI installed with the SDK. It never silently selects an older global CLI. The CLI chooses its recommended default model; set `PATCH_PARTY_CODEX_MODEL` explicitly only to a model available to your account. To use a different current CLI, set `PATCH_PARTY_CODEX_PATH` to its absolute executable path. User tool/plugin configuration remains excluded. Model defaults follow the [official Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk).

For an offline library check, use `npm run prove-codex:saved`. Bundled baselines are hand-authored and displayed as **Saved rule · library**; they carry no invented Codex generation evidence.

For the strict proposal-to-play browser proof, run `npm run test:e2e:live`. It generates a new rule, compares the accepted source/hash with the active artifact, collects a coin, and verifies gravity flips and expires. It fails on a build failure and never falls back. This command uses your Codex quota. Stop any existing local development server first; the test owns ports 3001 and 5173.

Milestone 2 was verified on October 29, 2026 (America/Denver): the live browser build took **6.025 seconds**. This is one observed run, not a timing guarantee. The accepted hash, runtime thread ID, source, validation checks, generation record and browser screenshot are preserved in [docs/milestone-2](docs/milestone-2/README.md).

## Development & Testing

```sh
npm test                 # lifecycle, isolation, proposals, recovery, and proof regressions + Twitch/authorization (56 tests)
npm run build            # TypeScript check + production frontend bundle
npm run test:e2e          # login, OBS, failure recovery, preview, activation, revert and library reuse
npm run test:e2e:live     # strict live Codex proposal-to-play proof (requires authentication)
npm run prove-codex      # strict live technical proof; no fallback
npm run prove-codex:saved # offline validation of bundled/saved artifact
```

## Structure

- `apps/server/party.ts`: round and ballot state machine, proposal parser, effect management.
- `apps/server/index.ts`, `server.ts`, `operator.ts`: loopback HTTP/WebSocket server, authenticated operator sessions, origin checks, controller ownership, and coordinator wiring.
- `apps/server/library.ts`: private saved-rule records, integrity checks, lobby preferences and artifact migration.
- `apps/server/twitch/`: broadcaster OAuth, private token storage, refresh and validation, EventSub subscription lifecycle and chat adapter.
- `apps/server/overlay.ts`, `apps/web/src/Overlay.tsx`: redacted public state and the read-only OBS route.
- `apps/server/codex/`: Codex SDK worker (`generate.ts`), rule coordinator state machine (`coordinator.ts`).
- `packages/rule-runner/`: Acorn AST validation, terminable QuickJS WebAssembly worker, behavioral verification suite (`index.ts`, `worker.mjs`).
- `packages/contracts/`: Shared message, intent, command, and artifact schemas.
- `packages/game/`: Phaser arcade physics arena with dynamic modifier support and effect HUD.
- `apps/web/src/`: React frontend with arena host, simulated chat, and `BuildPanel` rule workshop.
- `artifacts/rules/`: Local generated artifacts and generation records (ignored).
- `artifacts/baselines/`: Tracked, hand-authored recovery rules, validated again before use.
- `docs/milestone-2/`: Captured real live generation and browser evidence.
- `scripts/`: Dev runner, restricted Codex wrapper (`codex-restricted.mjs`), proof runner (`prove-codex.ts`).
- `tests/`: Domain invariants, coordinator state machine, rule runner isolation, and Playwright browser tests.

See [PLAN.md](PLAN.md) for milestone roadmap and submission details.
