#!/bin/sh

set -eu

project_id="jk-ai-app-builder"
data_dir=".firebase/emulator-data"

if [ -x /opt/homebrew/opt/openjdk@21/bin/java ]; then
  PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
  export PATH
fi

# emulators:exec owns both lifecycles: it starts the Firebase emulators before
# Vite and shuts them down when the frontend exits (including on Ctrl+C).
if [ -f "$data_dir/firebase-export-metadata.json" ]; then
  exec pnpm dlx firebase-tools emulators:exec \
    --only auth,firestore,functions \
    --project "$project_id" \
    --import="$data_dir" \
    --export-on-exit="$data_dir" \
    "pnpm dev:frontend"
fi

exec pnpm dlx firebase-tools emulators:exec \
  --only auth,firestore,functions \
  --project "$project_id" \
  --export-on-exit="$data_dir" \
  "pnpm dev:frontend"
