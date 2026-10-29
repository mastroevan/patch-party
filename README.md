# Patch Party

**Chat invents the rules. The streamer plays them.**

Milestones 1 & 2 are implemented:
- **Milestone 1**: Playable 45-second platform arena, simulated community chat, server-managed ballots, and three trusted sample mechanics.
- **Milestone 2**: Live Codex rule builder pipeline (`Chat chose → Building → Checking → Ready`), isolated QuickJS WebAssembly rule runner with strict language & memory boundaries, real Codex SDK execution worker, evidence inspection (thread ID, SHA-256 hash, duration, AST/determinism checks, source code), and streamer recovery controls (retry, cancel, skip, library fallback).

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The local state server listens on 127.0.0.1:3001. Both ports must be available. Keep the terminal running; Ctrl+C stops both processes.

### Trying Live Codex Mode

1. In the lobby, switch the **Rule Engine** dropdown to **Live Codex**.
2. Nominate a rule with simulated chat: e.g. `!rule every second coin flips gravity for 2 seconds`, or pick standard candidates like `!rule gravity`, `!rule moon`, or `!rule sprint`.
3. Click **Start round**, then focus the arena to move with A/D and jump with Space/W.
4. Viewers vote with `!vote 1`, `!vote 2`, or `!vote 3`.
5. Lock the ballot (`Lock vote`) or let the round finish.
6. The Rule Workshop initiates generation and validation:
   - Pipeline stages: `01 · Chat chose` → `02 · Codex builds` → `03 · Checks` → `04 · Ready`.
   - Checks are run in isolated QuickJS workers across 78 trusted behavioral scenarios and determinism replays.
   - If credits or API access are depleted, the streamer can click **Use saved rule · library** to load and verify a baseline artifact from `artifacts/rules/`, or **Skip rule · play original** to fall back to classic physics.
7. Once ready, click **Inspect generated code & validation evidence** to review the artifact's SHA-256 hash, thread ID, generation timing, and isolated checks.
8. Click **Play next round →**. A 3-second patch reveal introduces the generated rule, and the new round starts with the exact generated module active in the arena!

## Codex Technical Proof

To run the standalone technical proof script:

```sh
npm run prove-codex
```

This verifies SDK authentication against Codex, attempts live generation, and validates the accepted coin/gravity rule in the isolated QuickJS worker, printing the verified SHA-256 hash, thread ID, timings, and test checks.

## Development & Testing

```sh
npm test                 # lifecycle, rule runner, proposal and coordinator tests (26 unit tests)
npm run build            # TypeScript check + production frontend bundle
npm run test:e2e          # real Playwright browser walkthrough for both sample and Codex modes
npm run prove-codex      # standalone technical proof runner
```

## Structure

- `apps/server/party.ts`: round and ballot state machine, proposal parser, effect management.
- `apps/server/index.ts`: WebSocket server, message validation, controller ownership, coordinator wiring.
- `apps/server/codex/`: Codex SDK worker (`generate.ts`), rule coordinator state machine (`coordinator.ts`).
- `packages/rule-runner/`: Acorn AST validation, terminable QuickJS WebAssembly worker, behavioral verification suite (`index.ts`, `worker.mjs`).
- `packages/contracts/`: Shared message, intent, command, and artifact schemas.
- `packages/game/`: Phaser arcade physics arena with dynamic modifier support and effect HUD.
- `apps/web/src/`: React frontend with arena host, simulated chat, and `BuildPanel` rule workshop.
- `artifacts/rules/`: Validated rule artifacts and generation records.
- `scripts/`: Dev runner, restricted Codex wrapper (`codex-restricted.mjs`), proof runner (`prove-codex.ts`).
- `tests/`: Domain invariants, coordinator state machine, rule runner isolation, and Playwright browser tests.

See [PLAN.md](PLAN.md) for milestone roadmap and submission details.
