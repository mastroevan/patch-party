# Milestone 2 verification

Verified October 29, 2026 (America/Denver). Milestone 2's real proposal-to-play criterion is satisfied.

- [Live browser evidence](live-evidence.json): source, SHA-256, intent, runtime thread ID, timings, trusted checks, active artifact hash, and browser assertions.
- [Generation record](generation-record.json): exact accepted artifact, prompt, raw model response, and validation attempts. This record came from the browser's real live generation.
- [Browser screenshot](playthrough.png): arena after the generated rule was activated and its coin effect exercised.

The live build took 6.025 seconds. Runtime thread: `01a18af1-44a2-7602-9ae3-63ef12f69f58`. Accepted and active SHA-256: `f74f1e1618113c656b9fb7fe76133fad594d4072992c36cdfa82e1fafe7771b3`.

The browser test observed voting, a successful real build, accepted source/hash integrity, the same source/hash active in round two, coin collection, gravity flip, expiry, and no browser errors. It has no saved-rule fallback. Runtime generation threads are distinct from the project development thread required for submission.

Validation: 33 unit/integration tests; production build; 3 offline browser tests; 1 strict live browser test. Runtime infinite-loop and invalid-command regressions verify controls still respond and original physics is restored. Unit tests and offline browser recovery work with an empty `artifacts/rules/` directory because trusted hand-authored baselines are tracked separately.

Reproduce from the repository root:

```sh
npm install
npm test
npm run build
npm run test:e2e
npm run prove-codex:saved
# Requires Codex authentication and available quota:
npm run prove-codex
npm run test:e2e:live
```

Stop local development servers before browser tests. Playwright owns ports 3001 and 5173. Fresh browser evidence is written under `test-results/`; generated artifacts remain in ignored `artifacts/rules/`. A failed live generation exits unsuccessfully instead of substituting a saved rule.
