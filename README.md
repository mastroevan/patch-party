# Patch Party

**Chat invents the rules. The streamer plays them.**

Milestone 1 is a local playable vertical slice: a 45-second platform arena, a simulated community chat, server-managed ballots, and three trusted sample mechanics. Twitch connectivity and Codex generation are planned for subsequent milestones. Nothing in this version is presented as a live AI build.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The local state server listens on 127.0.0.1:3001. Both ports must be available. Keep the terminal running; Ctrl+C stops both processes.

1. Optionally nominate a sample with `!rule gravity`, `!rule moon`, or `!rule sprint` before starting.
2. Click **Start round**, then click the arena to focus it.
3. Move with A/D or left/right arrows. Jump with Space, W, or up arrow. Coins earn 10 points. Spikes respawn you and deduct 5 points, with a brief invulnerability window.
4. Send `!vote 1`, `!vote 2`, or `!vote 3` in the simulated chat. Change the viewer name to simulate another participant. Each viewer has one replaceable vote.
5. Lock the vote early or let the 45-second round end. **End round** is also available for quick demonstrations.
6. Click **Play next round**. A three-second reveal introduces the winner, then a new round begins with the sample mechanic active.

Gravity Glitch makes coins reverse gravity for three seconds. Moon Boots lowers gravity and increases airtime. Sugar Rush grants a three-second speed boost after collecting a coin. Coins respawn after four seconds. Effect clocks stop during pause.

Ties go to the lowest numbered slot. No votes selects the original rules. Reset returns to the lobby and preserves the current server session's best score. Restarting the server clears all state.

## Controls and connection behavior

Pause freezes physics and the round clock. Reset clears the ballot, score, active rule, and effects. The first connected tab is the game controller; additional tabs can send simulated chat but cannot run a second scoring game. If the controller disconnects, the round pauses and another connected tab can take control. A newly mounted controller starts at spawn; physics snapshots are not persisted in this milestone.

The application reconnects to the local server and receives a fresh state snapshot. Browser game input is active only when the arena is focused, so typing commands does not move the player. This desktop keyboard game has a responsive control layout but does not yet provide touch gameplay.

## Development

```sh
npm test                 # lifecycle, ballot and mechanic invariants
npm run build            # TypeScript check + production frontend bundle
npx playwright install chromium
npm run test:e2e          # real browser gameplay and round transition
```

The browser test can start the development servers or reuse ones already running. It resets the shared local session, so run it outside an active play session. The static frontend build is in `dist/`; the documented runtime for this milestone is `npm run dev`. `npm start` starts only the state server, not a static production host.

## Structure

- `apps/server/party.ts`: round and ballot state, shared chat command handler, trusted sample selection.
- `apps/server/index.ts`: loopback HTTP/WebSocket server, controller ownership, message validation, snapshots.
- `apps/web/src`: operator interface and simulated chat adapter.
- `packages/contracts`: shared messages, rule metadata, and state types.
- `packages/game`: Phaser arena and sample mechanic modifiers.
- `tests`: domain tests and browser walkthrough.

The simulated adapter sends normalized chat messages to the same `Party.chat` boundary intended for Twitch EventSub. Gameplay runs in the controller browser; the server accepts bounded coin/death reports and owns round deadlines and ballots. It is a local prototype, not an anti-cheat system or authenticated public service. Do not expose the development server publicly.

No credentials are required. Game art is drawn in code. The supplied Patch Party artwork is bundled at `apps/web/public/brand/patchparty.png`; CSS frames its wordmark for the header and welcome screen without modifying the original image. Optional Google Fonts have system-font fallbacks.

See [PLAN.md](PLAN.md) for later milestones and submission scope.
