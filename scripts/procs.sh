#!/usr/bin/env bash
# Sourced by scripts/fork.sh and scripts/stack.sh. PID files for the processes they start, and a stop that kills
# exactly those processes and their descendants, never anything matched by name.
#
#   pid_record PID FILE            write FILE: the PID on line 1, its start time (ps lstart) on line 2
#   pid_live FILE [PATTERN]        print the PID if that same process is still running; a PID the system has since
#                                  reused for another program has a different start time and is ignored. For an
#                                  older file without a start time, the command line must contain PATTERN
#   kill_tree PID                  SIGTERM to PID and every descendant (walked with pgrep -P, since macOS has no
#                                  setsid), up to 5 seconds' wait, then SIGKILL for any left
#   stop_pidfile FILE LABEL [PATTERN]  kill_tree the live PID in FILE, then remove FILE

pid_record() {
  local start
  start=$(ps -o lstart= -p "$1" 2>/dev/null || true)
  printf '%s\n%s\n' "$1" "$start" > "$2"
}

pid_live() {
  local pid start now
  [ -f "$1" ] || return 1
  pid=$(sed -n 1p "$1")
  start=$(sed -n 2p "$1")
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  now=$(ps -o lstart= -p "$pid" 2>/dev/null || true)
  [ -n "$now" ] || return 1
  if [ -n "$start" ]; then
    [ "$now" = "$start" ] || return 1
  else
    [ -n "${2:-}" ] || return 1
    ps -o command= -p "$pid" 2>/dev/null | grep -q -- "$2" || return 1
  fi
  echo "$pid"
}

pid_descendants() { # deepest first
  local child
  for child in $(pgrep -P "$1" 2>/dev/null || true); do
    pid_descendants "$child"
    echo "$child"
  done
}

kill_tree() {
  local pids alive p
  # Collect the whole tree before signalling: once a parent dies its children are re-parented and lost to pgrep -P.
  pids="$(pid_descendants "$1") $1"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    alive=""
    for p in $pids; do
      if kill -0 "$p" 2>/dev/null; then alive="$alive $p"; fi
    done
    [ -n "$alive" ] || return 0
    sleep 0.25
  done
  # shellcheck disable=SC2086
  kill -KILL $alive 2>/dev/null || true
}

stop_pidfile() {
  local pid
  if pid=$(pid_live "$1" "${3:-}"); then
    kill_tree "$pid"
    echo "stopped $2 (pid $pid)"
  fi
  rm -f "$1"
}
