#!/usr/bin/env bash
# PHP Syntax Linter Hook (php8.5 -l)
# Supports Claude Code and Antigravity hook contracts

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // .toolCall.args.TargetFile // .toolCall.args.file_path // empty')

if [ -n "$file" ] && [ "${file##*.}" = "php" ] && [ -f "$file" ]; then
  out=$(php8.5 -l "$file" 2>&1)
  if [ $? -ne 0 ]; then
    jq -nc --arg msg "$out" '{"systemMessage": $msg}'
    exit 0
  fi
fi

printf '{}\n'
