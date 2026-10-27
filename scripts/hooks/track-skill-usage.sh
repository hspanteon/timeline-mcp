#!/usr/bin/env bash
# Skill Usage Tracker Hook
# Logs skill invocations to ~/.claude/skill-usage.jsonl and announces invocation

payload=$(cat)
skill=$(printf '%s' "$payload" | jq -r '.tool_input.skill // .toolCall.args.skill // .toolCall.args.name // empty')

[ -z "$skill" ] && exit 0

log="${CLAUDE_SKILL_LOG:-$HOME/.claude/skill-usage.jsonl}"
mkdir -p "$(dirname "$log")" 2>/dev/null

cwd=$(printf '%s' "$payload" | jq -r '.cwd // .workspacePaths[0] // ""')
session=$(printf '%s' "$payload" | jq -r '.session_id // .conversationId // ""')
project=$(basename "$cwd")
ts=$(date -Is)

jq -nc --arg ts "$ts" --arg skill "$skill" --arg project "$project" --arg cwd "$cwd" --arg session "$session" \
  '{ts:$ts, skill:$skill, project:$project, cwd:$cwd, session:$session}' >> "$log" 2>/dev/null

jq -nc --arg s "$skill" '{systemMessage: ("\ud83e\udde9 Skill invoked: " + $s)}'
