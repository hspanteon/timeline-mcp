#!/usr/bin/env bash
# PHP CS Fixer Hook (PSR-12 / Symfony style rules)
# Supports Claude Code and Antigravity hook contracts

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // .toolCall.args.TargetFile // .toolCall.args.file_path // empty')

if [ -n "$file" ] && [ "${file##*.}" = "php" ] && [ -f "$file" ]; then
  dir=$(dirname "$file")
  root=$(cd "$dir" && git rev-parse --show-toplevel 2>/dev/null)
  config="${root:-.}/.php-cs-fixer.php"
  if [ -f "$config" ]; then
    (cd "$root" && php-cs-fixer fix --config="$config" --quiet "$file" 2>&1) >/dev/null 2>&1
  fi
fi

printf '{}\n'
