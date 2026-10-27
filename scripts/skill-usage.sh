#!/bin/bash
# Skill usage tracker for the duell plugin — shows which skills are used and which are dead weight
# Usage: ./plugins/duell/scripts/skill-usage.sh [--days N] [--project NAME]

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$PLUGIN_DIR/skills"
# The hook records plugin skills as "<plugin>:<skill>"; strip our own prefix to
# match the roster, but leave other plugins' names intact so they can't collide.
PLUGIN_NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$PLUGIN_DIR/.claude-plugin/plugin.json" 2>/dev/null | head -1)
PLUGIN_NAME="${PLUGIN_NAME:-duell}"
LOG="${CLAUDE_SKILL_LOG:-$HOME/.claude/skill-usage.jsonl}"

DAYS=""
PROJECT=""
while [ $# -gt 0 ]; do
    case "$1" in
        --days)    DAYS="$2"; shift 2 ;;
        --project) PROJECT="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "======================================================="
echo "        Duell Plugin — Skill Usage Tracker             "
echo "======================================================="
echo ""
echo "Log:    $LOG"
[ -n "$DAYS" ]    && echo "Window: last $DAYS days"
[ -n "$PROJECT" ] && echo "Filter: project = $PROJECT"
echo ""

if ! command -v jq &>/dev/null; then
    echo "Error: jq is required."; exit 1
fi

ROSTER=$(ls -1 "$SKILLS_DIR" 2>/dev/null)
if [ -z "$ROSTER" ]; then
    echo "Error: no skills found in $SKILLS_DIR"; exit 1
fi
TOTAL_SKILLS=$(printf '%s\n' "$ROSTER" | wc -l | tr -d ' ')

if [ ! -s "$LOG" ]; then
    echo "No usage log yet — the PostToolUse Skill hook has not recorded anything."
    echo "(Hook config loads at session start; restart Claude Code if you just added it.)"
    echo ""
    echo "All $TOTAL_SKILLS skills are currently unused:"
    printf '%s\n' "$ROSTER" | sed 's/^/  - /'
    exit 0
fi

SINCE="1970-01-01T00:00:00+00:00"
[ -n "$DAYS" ] && SINCE=$(date -Is -d "$DAYS days ago" 2>/dev/null || date -Is)

FILTERED=$(jq -c --arg since "$SINCE" --arg proj "$PROJECT" \
    'select(.ts >= $since) | select($proj == "" or .project == $proj)' "$LOG" 2>/dev/null)

TOTAL_CALLS=$(printf '%s' "$FILTERED" | grep -c . )
echo "Total skill invocations recorded: $TOTAL_CALLS"
echo ""

STATS=$(printf '%s\n' "$FILTERED" | jq -sr --arg p "$PLUGIN_NAME" '
    map(.skill |= (if startswith($p + ":") then .[($p|length)+1:] else . end))
    | group_by(.skill)[]
    | "\(.[0].skill) \(length) \(map(.ts)|max|.[0:10])"')

echo "-------------------------------------------------------"
echo " USED  (duell plugin skills)"
echo "-------------------------------------------------------"
printf "  %-34s %6s  %s\n" "SKILL" "USES" "LAST USED"
USED_COUNT=0
while read -r name uses last; do
    [ -z "$name" ] && continue
    if printf '%s\n' "$ROSTER" | grep -qx "$name"; then
        printf "  %-34s %6s  %s\n" "$name" "$uses" "$last"
        USED_COUNT=$((USED_COUNT + 1))
    fi
done <<< "$(printf '%s\n' "$STATS" | sort -k2 -rn)"
[ "$USED_COUNT" -eq 0 ] && echo "  (none)"

echo ""
echo "-------------------------------------------------------"
echo " NEVER USED  (candidates to cut or fix discoverability)"
echo "-------------------------------------------------------"
UNUSED=0
while read -r skill; do
    [ -z "$skill" ] && continue
    if ! printf '%s\n' "$STATS" | awk '{print $1}' | grep -qx "$skill"; then
        desc=$(awk '/^description:/{d=substr($0,13); gsub(/^[ \t]*/,"",d); if (d=="" || d==">-" || d==">" || d=="|" || d=="|-") {getline d; gsub(/^[ \t]*/,"",d)} print substr(d,1,70); exit}' "$SKILLS_DIR/$skill/SKILL.md")
        printf "  %-34s %s...\n" "$skill" "$desc"
        UNUSED=$((UNUSED + 1))
    fi
done <<< "$ROSTER"
[ "$UNUSED" -eq 0 ] && echo "  (none — every skill has been exercised)"

OTHER=$(printf '%s\n' "$STATS" | while read -r name uses last; do
    [ -z "$name" ] && continue
    printf '%s\n' "$ROSTER" | grep -qx "$name" || printf "  %-34s %6s  %s\n" "$name" "$uses" "$last"
done)
if [ -n "$OTHER" ]; then
    echo ""
    echo "-------------------------------------------------------"
    echo " OTHER SKILLS  (built-in / non-duell, for reference)"
    echo "-------------------------------------------------------"
    printf '%s\n' "$OTHER"
fi

echo ""
echo "-------------------------------------------------------"
echo " SUMMARY: $USED_COUNT/$TOTAL_SKILLS duell skills used, $UNUSED never used"
echo "-------------------------------------------------------"
