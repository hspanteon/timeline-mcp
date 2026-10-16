---
name: release-pr-check
description: Check every open (pending) pull request targeting the qa-release and master branches of Panteon-norway/duell-admin against the team's release-note format (the `- #<id> - <title>` list used in PR descriptions and GitHub Releases), report how many qa-release tickets QA has approved in Panteon Timeline (from each ticket's QA stage), and print one final summary. Can also prepare the two GitHub release notes: "Release note DD.MM.YYYY vX" for master and "QA Release note DD.MM.YYYY vX-qa" for qa-release, with not-approved tickets listed as held back. Run it from a duell-admin checkout. Use when asked to check pending PRs, review PRs before a QA or production release, prepare/draft a release note, or "what is waiting for qa-release / master". Report-only — never comments on, approves, edits or merges PRs, and never creates or edits GitHub releases.
argument-hint: [qa-release | master | both | master-note | qa-note | release-notes] (default both)
---

# Release PR Check

Answers, per open PR into `qa-release` and `master`: **is the release note in the description complete, and is the PR ready to go?** Ends with one consolidated summary. With a `-note` argument it instead prepares the GitHub release note text.

**Report-only.** Never comment on, label, approve, edit, close or merge a PR, never push, and never create, edit or publish a GitHub release or tag. Prepared release notes are printed in chat for the user to paste.

## 0. Preflight

This skill is specific to duell-admin. It runs `git` in the current directory, so that must be a duell-admin checkout:

```bash
git remote get-url origin   # must point at Panteon-norway/duell-admin
gh auth status
git fetch origin qa-release master
```

If the remote is not duell-admin, ask the user for the path to their duell-admin checkout and run the `git` commands there (`git -C <path> …`). Don't guess a path.

If `gh` is missing or not logged in, stop and tell the user to install it and run `gh auth login`. Do not try other auth routes, and never read tokens or `.env` files.

Repo: `Panteon-norway/duell-admin`. Pass `--repo Panteon-norway/duell-admin` to every `gh` call.

## 1. The release-note format

The team publishes release notes as GitHub Releases, and each PR description carries its own ticket's entry in the same format, so the release body is assembled by pasting PR entries together. Verify against the latest two releases if in doubt:

```bash
gh release list --repo Panteon-norway/duell-admin --limit 6
gh release view <tag> --repo Panteon-norway/duell-admin --json name,tagName,targetCommitish,body
```

### Release names and tags

| Release | Name | Tag | Target | GitHub flag |
|---|---|---|---|---|
| Production | `Release note DD.MM.YYYY vX.Y.Z.W` | `vX.Y.Z.W` | `master` | Latest |
| QA | `QA Release note DD.MM.YYYY vX.Y.Z.W-qa` | `vX.Y.Z.W-qa` | `qa-release` | Pre-release |

- The date is the release day, `DD.MM.YYYY`.
- Versions increase the last segment by one per production release (`v1.0.2.9` → `v1.0.3.0` → `v1.0.3.1`).
- A QA release uses the version of the production release it will become, plus `-qa`. For example, `v1.0.2.9-qa` was followed by `v1.0.2.9`.
- Not every production release has a QA release before it.
- Suggested next production version: an existing **draft** release's tag if there is one, otherwise the latest non-`-qa` tag + 1.
- Suggested next QA version: the next production version that has no `-qa` tag yet.
- Always show the suggested version as a suggestion for the user to confirm.

### Body format (also each PR's description)

```markdown
- #<id> - <Timeline ticket title, verbatim>
  - <what changed, user-facing, past tense or imperative, one line per change>
  - <another change>
- #<id> - <next ticket>
  - <change>
- Hotfixes
  - <hotfix without a ticket, one line each>
```

Rules observed in past releases:

- One top-level bullet per ticket: `#<id> - <title>`. The title is copied from Timeline and keeps prefixes like `BUG:`, `CRM:`, `SA:`, `[PRI2] [962044]`.
- Sub-bullets are indented 2 spaces and describe the visible change. They mention screens, columns, labels and Norwegian UI terms (`"Side 2 av 2"`, `Kontoplan`) where useful.
- Big features may use `**Bold lead-in.**` sub-bullets, or a third indent level grouped by area (e.g. `Payout Report Settings` → its points).
- No headings, no checklists, no "Testing" section, no PR numbers in the body.
- Work without a ticket goes into a final `- Hotfixes` group.
- No fixed order. In practice, the newest additions usually come first in production notes and last in QA notes.

### PR titles

- `PROD: #<id> <title>` is the most common form for PRs into `master`.
- `PROD: TL #<id> <title>` is also accepted.
- PRs into `qa-release` use `QA:`, or the branch name when merged via `git merge`.
- A PR with no task ID in its title or branch name is a hotfix.

## 2. Collect pending PRs

For each requested base (`qa-release`, `master`):

```bash
gh pr list --repo Panteon-norway/duell-admin --base <base> --state open --limit 100 \
  --json number,title,author,headRefName,body,isDraft,createdAt,updatedAt,reviewDecision,mergeable,labels,url
```

For every PR, also fetch checks and files (both are read-only):

```bash
gh pr checks <number> --repo Panteon-norway/duell-admin
gh pr view <number> --repo Panteon-norway/duell-admin --json files,commits,mergeStateStatus
```

Many task branches have a PR into both branches. Group them by `headRefName` / task ID, so the summary shows one row per task with its QA and production state side by side.

## 3. Check each PR

| Check | Pass when |
|---|---|
| Title | Has a `PROD:` prefix (for `master`) and a task ID (`#1234`, `TL #1234`, or a leading number in the branch name) |
| Entry line | The body has a top-level `- #<id> - <title>` bullet for the PR's ticket. The `<id>` matches the title/branch, and the title matches the Timeline title when known |
| Change bullets | At least one indented sub-bullet with real content. Not empty, not just a restated title ("Fixed <title>"), and not a vague single word ("fixed", "changes") |
| Format | No headings or checklists; 2-space indentation; bullets with `-`. So the entry can be pasted into the release unchanged |
| Consistency | The body mentions what the files show: a `cron/migrations/` file ⇒ a database change is mentioned; a new `'…'\|trans` / `Translator.trans` key ⇒ the key exists in `shared/translations` on the branch, otherwise flag "translation key missing" |
| Legacy mirror | A change to `shared/src/Entity/` or `shared/data/all-table.sql` ⇒ the body mentions the matching `duell-pos` PR (duell-admin's CLAUDE.md "Mirror every schema change" rule) |
| State | Not draft; `mergeable` is not `CONFLICTING`; required checks not failing; review decision is not `CHANGES_REQUESTED` |
| Via QA | A PR into `master` whose branch is not contained in `origin/qa-release` (`git rev-list --count origin/qa-release..origin/<branch>` > 0) and has no merged `qa-release` PR ⇒ **warning** "direct to master, not via QA". The team does ship small fixes this way, so this alone does not block |
| Age | Open > 14 days ⇒ flag as stale |

Ignore a `security/snyk` failure whose description is "You have used your limit of private tests". That's a quota problem, not a code problem: mention it once in the summary, not per PR.

Verdict per PR:

- **Ready**: all checks pass, warnings allowed.
- **Needs notes**: only release-note problems (title, entry line, change bullets, format, consistency).
- **Blocked**: draft, conflicts, failing required checks, or changes requested.

## 4. QA approval from Timeline

Run this step whenever `qa-release` is in scope, and for `master-note` / `qa-note` / `release-notes`. It answers: **of the tickets on (or heading to) qa-release, how many has QA approved?**

### Collect the tickets

Two sets, deduplicated by task ID:

- **On QA, not yet in production**: tickets merged into `qa-release` but not into `master`.
  ```bash
  git log --first-parent --merges --format='%s' origin/master..origin/qa-release
  ```
  - Take the task ID from the merged branch name: `Merge pull request #N from Panteon-norway/<id>-slug`, `Merge branch '<id>-slug' into qa-release`, or `Merge remote-tracking branch 'origin/<id>-slug'`.
  - Skip merges of `master` / `development`.
  - **Drop tickets already in production.** Branches usually reach `master` through their own PR, so the qa-release merge commit never does, and this log lists shipped tickets too (in Oct 2026, 28 of 52). For each branch, check its tip:
    ```bash
    git merge-base --is-ancestor origin/<branch> origin/master && echo in-master
    ```
    If the remote branch was deleted, look for a merged PR instead: `gh pr list --repo Panteon-norway/duell-admin --base master --state merged --head <branch> --json number`. A ticket in `master` by either check is already in production; leave it out of both sets. If neither check can decide, keep the ticket and add "unverified" to it.
  - List branches with no leading task ID separately as "no ticket". They're hotfix candidates.
- **Pending into QA**: the open `qa-release` PRs from step 2. Take the ID from the title or branch name.

### Read each ticket's status

Call the `get_task_statuses` tool of the `timeline-mcp` server **once**, with every task ID from both sets. Match the tool by its short name. It makes one light request per ticket, writes no files, and returns one row per ticket: title, stage (e.g. `QA in progress`, `Going live pending`), QA and Live stage progress, and a release state.

- Don't use `get_task_conversation` for this; it fetches the whole conversation and rewrites `task.md` for every ticket.
- Rows with `not found` or `invalid issue ID` are tickets whose ID didn't resolve. List them under "No ticket" with the reason.
- On an auth error, run `check_auth` once, report its result and skip this step.

`task_status` is `open` for every live ticket, so approval comes from the **QA stage**:

| Bucket | Release state from `get_task_statuses` | Meaning |
|---|---|---|
| Approved | `qa approved`, `live` | QA stage is done (Timeline usually shows "Going live pending") |
| Not approved | `in qa`, `qa blocked`, `before qa` | QA is still testing, blocked, or hasn't started |

A ticket that's still only an open PR into `qa-release` can't be approved yet. Count it as not approved, with the reason "not on QA yet", whatever its stage says.

Flag these mismatches between git and Timeline in the summary (they mean someone has to update one side):

- On `qa-release` but `before qa`: the code is on QA, but Timeline doesn't show it as handed to QA.
- `live` but its branch is not in `master` (by the check above): Timeline says it's in production, git doesn't.
- `qa approved` but no open or merged PR into `master`: approved, but nothing is heading to production.

## 5. Check report (no `-note` argument)

Print in chat. Don't write files unless the user asks; if they do, save to `timeline/release-checks/<YYYY-MM-DD>-release-pr-check.md`.

```text
RELEASE PR CHECK — <YYYY-MM-DD>
Latest releases: <prod tag> (<date>) · <qa tag> (<date>) · draft: <tag or none>

QA-RELEASE — <n> open (<r> ready · <m> needs notes · <b> blocked)
  #<num> #<id> <title> — @<author> — <age>d
    [READY | NEEDS NOTES | BLOCKED] <one-line reason>
    - <entry/format/consistency/state issue>

MASTER — <n> open (...)
  (same layout; add "direct to master, not via QA" warnings here)

BY TASK
  | Task | Branch | qa-release PR | master PR | Verdict |

QA APPROVAL (Timeline) — <a>/<total> tickets approved
  Approved:      #<id> <title>, ...
  Not approved:  #<id> <title> — <stage | not on QA yet>, ...
  No ticket:     <branch>, ...
  Mismatches:    #<id> <git state> vs <Timeline stage>, ...   (omit if none)

FINAL SUMMARY
- QA approved: <a>/<total> tickets (<n> not approved)
- Ready for QA release: #.., #..
- Ready for production: #.., #..
- Fix release notes first: #.. (<what>), ...
- Blocked: #.. (<why>), ...
```

Keep each PR to at most 4 lines. Link each PR number to its `url`. If a base has no open PRs, say so in one line.

## 6. Release-note mode — two separate notes

Arguments:

| Argument | Prints |
|---|---|
| `master-note` | The production note |
| `qa-note` | The QA note |
| `release-notes` | Both notes, master first |

If the user asks for "the release note" without saying which, ask.

Run steps 0–4 first. Then sort every ticket into exactly one bucket by **where its code is**:

| Bucket | Which tickets | Goes in |
|---|---|---|
| A. On QA, approved | In `origin/master..origin/qa-release` and Approved in Timeline | Master note |
| B. On QA, not approved | In `origin/master..origin/qa-release`, not Approved | QA note + master note's held-back group |
| C. New to QA | Open PRs into `qa-release` (not merged yet) | QA note, held-back group ("not on QA yet") |
| D. Direct to master | Open PRs into `master` whose branch isn't on `qa-release` | Master note, flagged in chat (not in the body) |
| E. Hotfixes | Merges / PRs with no task ID | `- Hotfixes` group of the note for their branch |

A ticket in both C and B (a follow-up PR for a ticket already on QA) goes in B, with "re-test" noted in chat.

### Building each entry

- Reuse the ticket's entry from its PR description as-is when it passes step 3.
- Otherwise, write it in the format from step 1: the Timeline title verbatim as the top line, then sub-bullets for the user-facing change. Base the sub-bullets on the PR description, the commit messages and the diff.
- Mark every entry you wrote or rewrote with `(drafted)` in the chat summary, never in the body, so the user can review it.
- Every ticket in a note's scope must appear. Never drop one to keep the note short.

### Master release note (production)

````text
Name: Release note <DD.MM.YYYY> v<next prod version>
Tag:  v<next prod version>   Target: master

```markdown
- #<id> - <title>
  - <change>
- Hotfixes
  - <change>
- Not approved (held back)
  - #<id> - <title> — <Timeline stage>
```
````

- Include buckets A and D, then E.
- `Not approved (held back)` lists every bucket B ticket. Leave the group out only when B is empty.
- If a draft release already exists, compare it with the generated note and list the differences in chat: in the draft but not in scope, and in scope but missing from the draft.

### QA release note (qa-release)

````text
Name: QA Release note <DD.MM.YYYY> v<next QA version>-qa
Tag:  v<next QA version>-qa   Target: qa-release   Pre-release: yes

```markdown
- #<id> - <title>
  - <change>
- Hotfixes
  - <change>
- Not approved (held back)
  - #<id> - <title> — not on QA yet
```
````

- The QA note is **cumulative**, as in past QA releases: it lists every ticket on `qa-release` not yet in `master` (buckets A and B), plus E.
- Order the entries oldest first, new additions last.
- `Not approved (held back)` lists the open bucket C PRs.
- Then, outside the code block, list in chat the bucket B tickets that are still waiting for QA approval, with their Timeline stage.

### Closing line

End with one line covering both notes:

`Master v<x>: <A+D> included, <B> held back · QA v<y>-qa: <A+B> on QA (<B> awaiting approval), <C> pending`
