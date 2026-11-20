# Contributing

Bug reports, focused fixes and documentation improvements are welcome. Open an issue for substantial behavior changes before implementing them. Include the AgentDeck, DSH and Node versions, the expected result, a minimal reproduction and relevant redacted diagnostics. Do not post credentials, private paths or conversation contents.

## Development

Use Node.js >=24.9.0 and an installed DSH >=0.2.2-rc.1 CLI on a POSIX development environment:

```sh
npm ci --ignore-scripts
npm run dev:link-host
npm run typecheck
npm test
npm run check:pack
```

The host-link script uses the installed DSH dependency closure. Set AGENTDECK_DSH_ROOT to that package directory when automatic CLI discovery is unavailable. The script changes only this checkout's node_modules and refuses to replace a different existing dependency.

Optional BrowserSkill fixtures need its public package, not a running browser:

```sh
npm install --prefix .ci-browser --ignore-scripts --no-audit --no-fund @wxg-prc-cpg/browser-skill-dsh-plugin@0.5.0
AGENTDECK_BROWSER_MODULE_BASE="$PWD/.ci-browser" npm test
```

The live browser probe is explicitly opt-in; see [verification scope](docs/validation.md). Do not run it against another person's sessions or change their profile, pairing or model policy to make a check pass.

## Change requirements

- Keep English and Chinese README content and visible locale keys aligned.
- Preserve native authorization, exact caller identity, cancellation and completion delivery. Use public DSH exports and its execution pipeline.
- Do not turn configured model metadata into an authorization grant or replace unknown resource values with invented defaults.
- Keep role revisions and running snapshots stable. Document schema or compatibility changes.
- Add focused regression coverage for observable failures. Reuse existing checks for documentation-only changes.
- Keep machine-local instructions, raw browser captures, Session history, build outputs and dependencies out of Git and distributable packages.
- Do not claim quality, cost or speed improvements without a matched native baseline.

Use a Conventional Commit subject such as `fix(browser): retain session ownership during cancellation`. Pull requests should explain the concrete behavior change and relevant validation. Pull requests and pushes to `main` run checks. A matching version tag starts the separate Release workflow, which requires those checks before npm publication and GitHub Release creation. See [releasing](docs/releasing.md) for the one-time npm trusted publisher setup, version/tag procedure and safe reruns.

Changes to README text and package metadata do not update an installed runtime. Use the native plugin manager for local application testing and follow any required restart instruction.

## License

Contributions are provided under the project's [MIT license](LICENSE). Include applicable attribution when adding third-party material.
