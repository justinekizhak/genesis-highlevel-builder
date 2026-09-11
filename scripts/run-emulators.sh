#!/bin/sh

set -eu

project_id="jk-ai-app-builder"
data_dir=".firebase/emulator-data"

if [ -x /opt/homebrew/opt/openjdk@21/bin/java ]; then
  PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
  export PATH
fi

if [ -f "$data_dir/firebase-export-metadata.json" ]; then
  exec pnpm dlx firebase-tools emulators:start \
    --only auth,firestore,functions \
    --project "$project_id" \
    --import="$data_dir" \
    --export-on-exit="$data_dir"
fi

exec pnpm dlx firebase-tools emulators:start \
  --only auth,firestore,functions \
  --project "$project_id" \
  --export-on-exit="$data_dir"
