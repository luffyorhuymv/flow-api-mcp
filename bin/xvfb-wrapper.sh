#!/bin/sh
# Wrapper to run flow-api with virtual display (Xvfb) when real headed Chrome is needed inside Docker
if [ "$USE_XVFB" = "true" ] && [ "$HEADLESS" = "false" ]; then
  echo "[xvfb-wrapper] starting virtual display..." >&2
  Xvfb :99 -screen 0 1440x900x24 -ac &
  XVFB_PID=$!
  sleep 1
  export DISPLAY=:99
  trap "kill $XVFB_PID 2>/dev/null" EXIT
fi
exec node bin/flow-api.js "$@"
