#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/../local-engine"
echo "==================================================="
echo "  Starting Antigravity Local Agent Engine Daemon..."
echo "==================================================="
npm start
