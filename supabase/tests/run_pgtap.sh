#!/usr/bin/env bash
# supabase/tests/run_pgtap.sh — execute all pgTAP test files via psql.
#
# Usage:
#   bash supabase/tests/run_pgtap.sh                  # runs all .test.sql files
#   bash supabase/tests/run_pgtap.sh inventory        # filters by name fragment
#
# Requires:
#   - `supabase start` must be running (db container exposed on port 54322)
#   - pgTAP extension installed in the DB (created on demand by each test file)
#
# The script reports a TAP-style summary at the end. Exit non-zero if any
# test file emits "# Looks like you failed N test(s)".

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_The_Breakery_ERP}"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTER="${1:-}"

shopt -s nullglob
mapfile -t TEST_FILES < <(find "$TEST_DIR" -maxdepth 1 -name "*.test.sql" | sort)

if [[ -n "$FILTER" ]]; then
  TEST_FILES=("${TEST_FILES[@]/#*$FILTER*.test.sql/&}")
  # shellcheck disable=SC2207
  TEST_FILES=($(printf '%s\n' "${TEST_FILES[@]}" | grep -E "$FILTER" || true))
fi

if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "No pgTAP test files matched filter='$FILTER' in $TEST_DIR"
  exit 1
fi

FAIL_COUNT=0
for f in "${TEST_FILES[@]}"; do
  echo "=== $(basename "$f") ==="
  output=$(docker exec -i "$DB_CONTAINER" psql -U postgres -At -v ON_ERROR_STOP=1 -f - < "$f" 2>&1)
  echo "$output" | grep -E '^(ok|not ok|# )' || true
  if echo "$output" | grep -q '^# Looks like you failed'; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  if echo "$output" | grep -q 'psql:.*ERROR'; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "$output" | grep -E 'psql:.*ERROR' | head -3
  fi
done

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo
  echo "pgTAP: $FAIL_COUNT file(s) had failures."
  exit 1
fi
echo "pgTAP: all files passed."
