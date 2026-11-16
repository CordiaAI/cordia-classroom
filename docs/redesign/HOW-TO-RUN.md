# How to run the redesign in Claude Code

One Fable 5.2 director hands each task to an Opus 5.5 builder, checks the work, and sends a separate Opus 5.5 gatekeeper to run the website-finish gate. Work that passes is merged into `redesign/chat-first`. Work that fails goes back to the same builder with the exact failures, and the cycle repeats until it passes or hits the stop rule.

## What's in the kit

| File | What it does |
| --- | --- |
| `.claude/agents/director.md` | The director. Runs on `claude-fable-5-2`. Can only spawn `builder` and `gatekeeper`, and has no Edit tool, so it can't write product code itself. |
| `.claude/agents/builder.md` | Does one task. Runs on `claude-opus-5-5`. Finishes with the website-finish gate in fix mode. |
| `.claude/agents/gatekeeper.md` | Independent reviewer. Runs on `claude-opus-5-5`, read-only, with Playwright for screenshots. Runs the website-finish gate in report mode and returns a verdict. |
| `.claude/settings.json` | Lets the director wait for each subagent, and blocks pushing to `main`, merging PRs, deploying and applying migrations, for every agent. |
| `docs/redesign/PLAN.md` | Tasks T0 to T10, their order, acceptance criteria, and the feature map. |
| `docs/redesign/DESIGN-SPEC.md` | The look: glass v2 tokens, layout, every screen, copy, motion. Also the design direction the finish gate reuses. |
| `docs/redesign/screens/` | The four mockups from the canvas. |
| `docs/redesign/STATUS.md` | The run's ledger. The director updates it and resumes from it. |
| `scripts/redesign-gate.sh` | The same checks CI runs, plus a raw-colour check. |

## Set up once

1. **Install the website-finish plugin in Claude Code.** The agents call `/website-finish`, and Claude Code doesn't share plugins with claude.ai. Install it from the same marketplace you got it from with `/plugin`, then type `/website-finish` in a session to confirm it shows up.
2. **Copy the kit into the repo root.** If `.claude/settings.json` already exists, merge the `env` and `permissions.deny` entries into it rather than replacing it.
3. **Check the tools the agents use:** `gh auth status` (for the pull request at the end), `node --version`, and `python -m pyflakes --version`. Playwright's MCP server downloads itself through `npx` the first time the gatekeeper runs.
4. **Trust the folder** when Claude Code asks, so the gatekeeper's Playwright server can load.

## Start a run

```bash
cd ~/cordia-classroom
git checkout main && git pull
claude --agent director
```

Then send:

```text
Start the redesign run. Read PLAN.md, DESIGN-SPEC.md and STATUS.md, then begin with T0.
```

To check which model each agent is on while it runs, use `/tasks`. The director shows as Fable 5.2, and builders and gatekeepers as Opus 5.5.

## Pick it back up later

```bash
cd ~/cordia-classroom
git checkout redesign/chat-first && git pull
claude --agent director
```

```text
Resume the redesign run from STATUS.md.
```

## What "pushed through" means here

Passing work is merged into `redesign/chat-first` and pushed to GitHub. It never goes to `main` on its own. When every task is merged or blocked, the director opens one pull request into `main` and stops. You review it and merge it. Vercel builds a preview for the PR, so you can click through the whole redesign before it's live.

## The stop rule

A task gets five attempts. If it fails a fifth time, or the same failure comes back after the builder said it was fixed, the director marks it blocked, writes down exactly what's failing, and moves on to tasks that don't depend on it. Without this, a task the model can't solve would loop and burn usage forever.

## After the run

1. Read the PR's description, including the final website-finish report.
2. Click through the Vercel preview.
3. Look at the blocked tasks in `STATUS.md` and decide each one.
4. Review any migration marked NOT APPLIED, and apply it yourself if it's right.
5. Merge the PR. Then, for backend changes, run `cd ~/cordia-classroom && git checkout main && git pull && cd backend && fly deploy`, and check `fly logs`.

## Cost

Fable 5.2 and Opus 5.5 are the most expensive models, and each task costs a build, a review and maybe several fix rounds. Expect the full run to use a lot of your plan's usage. If you hit limits mid-run, nothing is lost: STATUS.md records where it stopped.
