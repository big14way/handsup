#!/bin/sh
# Runs the packaged build in the simulator, talking to https://handsuphq.vercel.app,
# the way it runs on G2. For recording the demo.
#   npm run demo -w glasses              # enter the host code on the phone screen
#   npm run demo -w glasses -- 123456    # pair straight away with this code
set -e
cd "$(dirname "$0")/.."
npx vite build
npx vite preview --port 4173 --strictPort &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null' EXIT INT TERM
sleep 2
npx evenhub-simulator --glow --automation-port 9898 "http://localhost:4173/${1:+?code=$1}"
