#!/bin/sh
# Cross-platform hook runner: resolves node (fnm-managed machines often lack
# it on /bin/sh PATH) and execs the hook script. Exits 0 when node is truly
# absent so hooks degrade gracefully instead of failing every turn.
# Usage: sh with-node.sh <hook.mjs>
HOOK="$1"
NODE_BIN=$(command -v node 2>/dev/null || true)
if [ -z "$NODE_BIN" ]; then
  if command -v fnm >/dev/null 2>&1; then
    FNM_BIN=$(fnm env --shell posix 2>/dev/null | sed -n 's/.*PATH=[^:]*:\([^;]*\).*/\1/p' | head -1)
    for candidate in "$FNM_BIN/node" "$HOME/.local/share/fnm/aliases/default/bin/node" "$HOME/Library/Application Support/fnm/aliases/default/bin/node"; do
      if [ -x "$candidate" ]; then
        NODE_BIN="$candidate"
        break
      fi
    done
  fi
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  for candidate in /usr/local/bin/node /usr/bin/node "$HOME/.local/bin/node"; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  # No node anywhere — degrade gracefully (hook is a no-op, not a failure).
  exit 0
fi
exec "$NODE_BIN" "$HOOK"
