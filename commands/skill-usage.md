---
description: Report duell skill usage — counts, last-used dates, and which skills have never fired
argument-hint: "[--days N] [--project NAME]"
allowed-tools: Bash
disable-model-invocation: true
---

Run this exact command with the Bash tool, substituting any arguments the user passed after the command name:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/skill-usage.sh" $ARGUMENTS
```

Run it once. Do not hand-roll the report with `find`, `grep`, or `awk` over the plugin directory — the script is the source of truth and already handles the `<plugin>:<skill>` prefix the hook writes. If it fails, say so and stop.

It reads `~/.claude/skill-usage.jsonl`, written by the plugin's `PostToolUse` hook on every `Skill` tool call (override the path with `CLAUDE_SKILL_LOG`).

Then summarise, in a few lines:

- Which skills are being used, and how often.
- What sits in **NEVER USED**. While the plugin is in development this is the point of the tracker: a skill that never fires is either redundant, or its `description` is too vague for the model to match against. Say which of the two you suspect for the notable ones.
- Only a skill's `description` is in context at match time — its body, including any "Not this skill" disambiguation section, is invisible until after the skill loads. So judge vagueness from the description alone.
- Skills with `disable-model-invocation: true` never appear unless someone typed `/<name>`. Exclude them from the never-fired count rather than calling them dead.
- State the sample size. A handful of records means "not yet exercised", not "dead".

Do not restate the table; it is already on screen.
