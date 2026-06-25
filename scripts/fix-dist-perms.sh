#!/usr/bin/env bash
# Fix ownership of dist/ so Vite can clean + rebuild it.
# The dist/assets/ dir was created as root (likely a Docker build) and Vite
# can't rmSync it as a non-root user → EACCES on `bun run build`.
#
# Usage: sudo ./scripts/fix-dist-perms.sh
set -euo pipefail

DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"

if [ ! -d "$DIST_DIR" ]; then
	echo "No dist/ directory found — nothing to fix."
	exit 0
fi

OWNER="$(stat -c '%U:%G' "$DIST_DIR")"
echo "dist/ is currently owned by: $OWNER"

if [ "$OWNER" = "root:root" ]; then
	echo "Fixing ownership to $(stat -c '%U:%G' "$(dirname "$DIST_DIR")") ..."
fi

# chown the whole dist/ tree to the same owner as the repo root
chown -R --reference="$(dirname "$DIST_DIR")" "$DIST_DIR"
echo "Done. dist/ is now owned by: $(stat -c '%U:%G' "$DIST_DIR")"
