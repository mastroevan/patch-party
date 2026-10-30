import {
  CANDIDATES,
  RULES,
  voteCounts,
  type PartyState,
} from "../../packages/contracts/index.ts";
import type { TwitchStatus } from "../../packages/contracts/twitch.ts";
export function overlayState(s: PartyState, twitch: TwitchStatus) {
  const counts = voteCounts(s);
  return {
    phase: s.phase,
    paused: s.paused,
    round: s.round,
    remainingMs: s.remainingMs,
    score: s.score,
    active: {
      name: s.activeArtifact?.name ?? RULES[s.activeRule].name,
      description:
        s.activeArtifact?.description ?? RULES[s.activeRule].description,
      author: s.activeAuthor,
    },
    ballot: {
      status: s.ballot,
      counts,
      total: counts.reduce((a, b) => a + b, 0),
      candidates: CANDIDATES.map((id) => ({
        name: RULES[id].name,
        description:
          s.mode === "codex"
            ? s.intents[id].description
            : RULES[id].description,
        author: s.authors[id],
      })),
    },
    next: s.pendingRule
      ? {
          name: s.build.artifact?.name ?? RULES[s.pendingRule].name,
          description:
            s.build.artifact?.description ??
            (s.mode === "codex" && s.pendingRule !== "classic"
              ? s.intents[s.pendingRule].description
              : RULES[s.pendingRule].description),
          author: s.pendingAuthor,
          source: s.selectionSource,
        }
      : null,
    build: { status: s.build.status },
    twitch: { state: twitch.state, channel: twitch.channel, gap: twitch.gap },
  };
}
