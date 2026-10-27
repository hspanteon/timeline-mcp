#!/usr/bin/env bash
# Entity Location Guard: Enforce entities only in shared/src/Entity/
# Supports Claude Code and Antigravity hook contracts

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .toolCall.args.TargetFile // .toolCall.args.file_path // empty')

case "$file" in
  *"/backoffice/src/Entity/"*|*"/cron/src/Entity/"*|*"/api/src/Entity/"*)
    reason="Entities belong in shared/src/Entity/ only. Do not create entity classes in app-local src/Entity directories (see docs/duell-admin.md)."
    # If Antigravity (contains .toolCall)
    if printf '%s' "$payload" | jq -e '.toolCall' >/dev/null 2>&1; then
      jq -nc --arg r "$reason" '{"decision": "deny", "reason": $r}'
    else
      # Claude Code format
      jq -nc --arg r "$reason" '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": $r}}'
    fi
    exit 0
    ;;
  *)
    if printf '%s' "$payload" | jq -e '.toolCall' >/dev/null 2>&1; then
      printf '{"decision": "allow"}\n'
    else
      printf '{}\n'
    fi
    ;;
esac
