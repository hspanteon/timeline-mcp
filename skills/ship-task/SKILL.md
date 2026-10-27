---
name: ship-task
description: Branch, commit, push, and PR conventions for duell-admin. Use when Claude is asked to commit work, create or name a branch, push changes, or open a pull request for a task.
argument-hint: "[branch-name]"
user-invocable: true
disable-model-invocation: true
---

# Ship Task

**Announce this skill.** The first line of your reply must be:

`🧩 Skill: ship-task`

followed by a blank line. If you use more than one skill in a reply, add one such line per skill, in the order you used them. Never write this line for a skill you did not actually load.

House conventions for getting duell-admin work from working tree to pull request. Follow these exactly — they match the existing history on `Panteon-norway/duell-admin`.

## Branching

- Base branch for feature/bug work and for PRs: **`development`** (never commit to it directly).
- Branch name: **`<task-id>-<short-kebab-slug>`** — e.g. `4064-giftcard-report`, `5476-last-ordernumber-row-query`, `5431-bug-crm-missing-time-in-log`.
- Bug branches may include `bug` in the slug. Keep the slug short (2–5 words).
- If work has no timeline task ID, ask for one before creating the branch; use a plain descriptive slug only if the user says there is no task.

## Pre-commit checklist

Run before every commit, scoped to touched files:

1. `php8.5 -l <file>` for every touched PHP file.
2. `php-cs-fixer fix --config=.php-cs-fixer.php -- <files>` from the **repo root** (config lives there). Do this before committing so no separate "Run php-cs-fixer" commit is needed.
3. `tools/sentinel/bin/sentinel rules --diff=development` (or `tools/sentinel/bin/sentinel rules --paths=<files>`) — ensure no legacy aliases, EM mismatches, missing CSRF, or route drift are introduced.
4. Touched JS entries: `npm run dev` in `backoffice/` must build clean.
5. If exposed routes changed: re-dump `public/js/routes.json` and rebuild — but **do not commit it**; `public/js/routes.json` and `public/build/` are untracked build artifacts. Never `git add -f` them.
6. `git status` — confirm nothing unrelated (e.g. `quick-clean.sh`, `var/`, local config) is staged.


## Commit messages

- Task work: **`TL #<task-id>: <what was done>`** — e.g. `TL #4064: Giftcard report module upgrade from legacy.`
- Hotfixes without a task ID: **`Fix: <summary>`** or **`hotfix: <summary>`**.
- One logical change per commit; plain sentences, ending period is the house style.
- Never commit unless the user asked; never amend or force-push published commits.

## Pull requests

- Open with `gh`, base **`development`**, head the task branch on `Panteon-norway/duell-admin`.
- Title: **`PROD: TL #<task-id> <short summary>`** — e.g. `PROD: TL #5476 last order number query optimized and put at one common place`. (`Fix:` may follow the ID for bug PRs: `PROD: TL #3941 Fix: Sales report compare negative BF.`)
- Body: brief summary of what changed and why, notable preserved contracts (routes, payloads), validation performed, and any manual QA steps for the reviewer.
- Do not merge PRs; merging is a human decision.

## After pushing

Report: branch name, commits pushed, PR URL, and anything deliberately left out of the PR (untracked artifacts, unrelated local changes).
