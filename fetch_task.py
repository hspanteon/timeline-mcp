#!/usr/bin/env python3
"""
Command-line fetcher for a single Panteon Timeline task.

Reuses the same orchestration as the MCP tool (panteon_client.fetch_and_save) so
the two stay in sync. Credentials come from the environment (.env) by default.

Examples:
    python3 fetch_task.py 5461
    python3 fetch_task.py "https://timeline.panteon.no/tasks#/list/15033/edit/4079"
    python3 fetch_task.py 5461 --print
    python3 fetch_task.py 5461 --base-dir /path/to/project
"""
import argparse
import sys

# Importing panteon_client loads the .env next to it (see panteon_client.py).
import panteon_client


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "issue",
        help="Task URL (…/edit/<id>) or bare numeric issue ID.",
    )
    parser.add_argument(
        "--base-dir",
        default=None,
        help="Output root; defaults to PANTEON_TIMELINE_DIR or the current directory.",
    )
    parser.add_argument(
        "--print",
        dest="print_body",
        action="store_true",
        help="Also print the rendered task markdown to stdout.",
    )
    args = parser.parse_args(argv)

    try:
        result = panteon_client.fetch_and_save(args.issue, base_dir=args.base_dir)
    except (ValueError, PermissionError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Task {result['issue_id']} saved to {result['saved_file']}")

    if args.print_body:
        print()
        print(
            panteon_client.render_task_markdown(
                result["issue_id"], result["task_meta"], result["comments"]
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
