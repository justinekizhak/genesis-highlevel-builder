#!/bin/sh

set -eu

project_id="jk-ai-app-builder"
data_dir=".firebase/emulator-data"

if [ -x /opt/homebrew/opt/openjdk@21/bin/java ]; then
  PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
  export PATH
fi

# The emulator serves functions/lib (compiled JS), not functions/src directly, so
# it must be built before starting and rebuilt on every change or the emulator
# silently serves stale code.
pnpm --dir functions run build

pnpm --dir functions run build:watch &
watch_pid=$!
trap 'kill "$watch_pid" 2>/dev/null' EXIT INT TERM

if [ -f "$data_dir/firebase-export-metadata.json" ]; then
  pnpm dlx firebase-tools emulators:start \
    --only auth,firestore,functions \
    --project "$project_id" \
    --import="$data_dir" \
    --export-on-exit="$data_dir"
else
  pnpm dlx firebase-tools emulators:start \
    --only auth,firestore,functions \
    --project "$project_id" \
    --export-on-exit="$data_dir"
fi
