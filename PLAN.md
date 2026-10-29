# Patch Party implementation plan

## Product promise

Chat invents the rules. Codex makes them playable.

A streamer plays a short coin-collecting platform arena while viewers propose and vote on the next rule. Codex implements the winning proposal, the application validates it, and the streamer activates it at the next round boundary. Everyone sees the resulting change and the proposing viewer receives credit.

## MVP decisions

- One streamer, one Twitch channel, one arena, keyboard controls.
- A 45-second round with coins, platforms, hazards, score, and quick respawn.
- Chat commands: `!rule <proposal>` and `!vote <1|2|3>`.
- Three shortlisted proposals; one latest vote per Twitch user per ballot.
- Streamer chooses the shortlist and can reject, skip, pause, reset, or revert a rule.
- One active generated rule at a time; previous rules enter a small reusable library.
- Initial supported mechanics: gravity changes, movement changes, and bounded coin/hazard effects.
- First proof: collecting a coin reverses gravity for a bounded duration.
- No viewer accounts, Twitch Extension, payments, channel points, multiplayer networking, or arbitrary game generation in the MVP.

## Experience and visual design

Use a colorful arcade presentation with a large game viewport, legible score and timer, and a three-card ballot. Keep camera space clear. A persistent sentence explains the current rule. Credit its author in a small badge.

During generation, show “Chat chose → Building → Checking → Ready”. Keep the current round playable. Activation is an explicit round transition with a short rule reveal and countdown. Developer details belong in the control panel, with a compact proof view available for the demo.

Viewer timing follows server receipt timestamps and generous ballot windows. Votes are not reaction-time gameplay, so broadcast delay does not determine player success. Late votes receive a clear closed-ballot result.

## Proposed stack and structure

- TypeScript workspace with a Node backend and React/Vite frontend.
- Phaser for the arena and rendering; React for controls, ballot, and status.
- Official Codex TypeScript SDK in a dedicated server-side build worker.
- Twitch EventSub WebSocket for incoming chat; Helix for subscriptions and optional bot replies.
- Application WebSocket for game/control/overlay state.
- SQLite for proposals, rounds, accepted artifacts, and generation evidence.
- Unit/integration tests for mechanics and lifecycle; browser tests for the playable flow.

Proposed directories:

```text
apps/server/        Twitch connection, ballots, round lifecycle, persistence
apps/web/           streamer game, control panel, OBS overlay routes
packages/contracts/ shared event and rule schemas
packages/game/      arena mechanics and rule host
packages/rule-runner/ isolated generated-rule evaluation
artifacts/          validated rule artifacts and generation records
docs/               setup, architecture, demo script
```

The interactive game runs in the streamer's browser and is captured in OBS. The OBS browser-source route displays ballots and build status without starting another game simulation. Only one active game controller may report round outcomes.

## Codex integration and execution boundary

Each accepted proposal becomes a bounded engineering task containing the rule interface, supported actions, current arena constraints, and trusted acceptance tests. Viewer text is supplied as untrusted proposal data, never as operational instructions.

Codex produces a JavaScript rule module and a manifest describing its name, explanation, hooks, and limits. The module consumes serialized game state and returns commands through a narrow interface, such as bounded gravity, jump, speed, or coin effects. It cannot directly mutate Phaser objects or access browser APIs.

Separate two boundaries:

1. The Codex build worker operates in a disposable restricted workspace without Twitch tokens, OBS credentials, or application secrets. Its configured Codex authentication stays outside generated artifact execution.
2. Generated code executes in an actual isolated JavaScript interpreter hosted by a terminable worker, with no filesystem/network bindings and explicit execution/memory limits. Select and verify the interpreter during the first technical spike. A Web Worker or Node `vm` alone is not the security boundary.

Start with event hooks such as coin collection and round start, rather than executing generated code every animation frame. The trusted game host validates returned commands and clamps magnitude, duration, and entity count.

Validation pipeline:

1. Check module and manifest shape and allowed language surface.
2. Evaluate with hard execution and memory limits.
3. Run trusted deterministic scenarios and host invariants.
4. Verify the specific proposed mechanic with a targeted acceptance scenario.
5. Smoke-test the artifact in the browser game.
6. Save accepted artifact hash and evidence; make it available for streamer activation.

Codex-generated tests may supplement trusted checks but cannot replace them. Limit repair attempts and overall generation time. On timeout, rejection, or worker failure, continue the existing game and offer retry or a clearly labeled saved rule. Never present a cached rule as newly generated.

Save prompt, output, validation results, SDK runtime thread ID, timings, and artifact hash. Preserve the project development Codex thread ID separately for the submission.

## Round and build lifecycle

Round lifecycle: lobby → playing → results → rule reveal → next round.

Ballot lifecycle: collecting → shortlisted → voting → locked.

Build lifecycle: queued → generating → validating → ready or failed.

Run these as coordinated state machines so a slow build does not freeze a round. Only one generation job runs at a time. Bind every result to its ballot ID; ignore stale completion events after a reset. Activate only accepted artifacts at a round boundary. Apply cooldowns and input length limits to proposals and deduplicate incoming Twitch events by message ID.

## Ordered milestones and completion criteria

### 1. Playable local vertical slice — implemented

Scaffold the workspace, build the arena and controls, and implement the lifecycle. Add a clearly labeled simulated-chat adapter that exercises the same command handlers as Twitch.

Done when: a player can finish a round, simulated viewers vote, and a trusted sample rule activates for the next round with score and reset behavior intact.

Implementation: local Node/WebSocket authority, React/Phaser arena, simulated chat, three built-in rules, pause/reset/reveal controls, and logic/browser tests. Setup and current boundaries are documented in README.md.

### 2. Codex technical proof — highest-risk work first — implemented

Verify SDK authentication and a real generation call. Implement the isolated rule runner and command interface. Generate the coin/gravity rule, validate it, and activate the exact resulting artifact in the arena.

Done when: the full proposal-to-play loop works with a real Codex output; infinite loops, invalid commands, and failed builds leave gameplay responsive. Measure generation time before promising any demo timing.

Implementation: Codex SDK execution worker in disposable workspace (`apps/server/codex/generate.ts`, `scripts/codex-restricted.mjs`); isolated QuickJS execution in dedicated worker with CPU/memory limits and AST checks (`packages/rule-runner/`); rule coordinator lifecycle machine with progress streaming, timeouts, and cancel/retry/skip/library fallback recovery (`apps/server/codex/coordinator.ts`); dynamic modifier engine in Phaser arena (`packages/game/Arena.ts`); interactive Rule Workshop UI with 4-stage pipeline and code/evidence inspector (`apps/web/src/BuildPanel.tsx`); technical proof runner (`scripts/prove-codex.ts`) and verified artifacts (`artifacts/rules/`); comprehensive unit and end-to-end browser tests.

### 3. Twitch and OBS integration

Register/configure a Twitch application, implement the appropriate user OAuth flow and required chat scopes, and create EventSub subscriptions. Handle keepalive, reconnect, token renewal, revocation, and duplicate events according to current Twitch documentation. Keep credentials server-side. Add connection health to the control panel.

Provide OBS setup instructions for game capture and browser overlay. Authenticate control endpoints and keep read-only overlay access distinct from operator controls.

Done when: two real viewer accounts submit/vote on a live Twitch test stream, the ballot locks correctly, and the broadcast shows the accepted rule in action. Test reconnection without double-counting votes; do not claim recovery of chat events Twitch does not replay.

### 4. Presentation and operator recovery

Polish ballot cards, rule reveal, credits, readable instructions, sound cues, and restrained motion. Add preview, activation, cancel, pause, revert, and reset controls. Persist accepted rules and restore a clean lobby after restart.

Done when: a new viewer understands how to participate from the broadcast, and the streamer can recover from a failed generation without restarting OBS or the application.

### 5. Submission evidence

Create a Git repository and public GitHub/GitLab remote, document installation and configuration with an example environment file, and exclude secrets and private logs. Record the actual development thread ID and a concise architecture explanation.

Record a video under three minutes showing real Twitch participation, Codex generation evidence, gameplay transformation, and streamer controls. Upload to YouTube and finish the submission fields. Repository publication and video upload require the user's destination accounts/access.

Done when: a fresh checkout runs from the README, the linked video is accessible, and the repo, development thread ID, and video are ready for submission.

## Test priorities

- Votes: duplicates, vote changes, ties, late messages, and empty ballots.
- Builds: timeout, invalid output, stale results, repair exhaustion, and worker termination.
- Rules: bounded commands, finite values, duration expiry, deterministic behavior, and reset.
- Lifecycle: activation only between rounds, rollback, disconnects, and restart.
- End-to-end: a real generated rule and a live Twitch ballot, plus a repeatable simulated flow for development.

## Demo storyboard (target 2:40)

- 0:00–0:15: Show the transformation immediately and explain the hook.
- 0:15–0:40: Show real viewers proposing and voting on Twitch.
- 0:40–1:15: Show Codex building the rule, the relevant artifact, and trusted validation. Label any time compression honestly.
- 1:15–1:55: Activate the accepted rule and show the streamer playing it.
- 1:55–2:20: Show audience credit, operator controls, and another supported mechanic.
- 2:20–2:40: Explain the architecture, Codex development contribution, and repository.

## Delivery priorities

As of October 29, the published November 2 deadline leaves a short build window. Complete milestones 1 and 2 first, integrate live Twitch next, and reserve the final day for broadcast rehearsal, fixes, and submission. Cut extra mechanics before cutting the real Codex loop or live Twitch proof.

Required external setup during implementation: Twitch developer app/client ID, broadcaster authorization, working Codex SDK authentication, OBS, and repository/video destinations. Local gameplay and simulated chat can proceed before those are available.

## References

- Rules: https://twitchcon-codex.devpost.com/rules
- Codex SDK: https://learn.chatgpt.com/docs/codex-sdk
- EventSub WebSockets: https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
- Twitch chat authorization: https://dev.twitch.tv/docs/chat/authenticating/
- OBS browser sources: https://obsproject.com/kb/browser-source
