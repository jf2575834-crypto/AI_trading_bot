#!/usr/bin/env bash
set -e

# Move to the TradeMind project root.
cd "$(dirname "$0")/.."

# Use the project's virtual environment.
if [ ! -x ".venv/bin/python" ]; then
    echo "Virtual environment not found."
    echo "Create it and install the project dependencies first."
    exit 1
fi

echo "Starting TradeMind Backend..."
echo "API: http://127.0.0.1:8000"
echo "Documentation: http://127.0.0.1:8000/docs"

.venv/bin/python -m uvicorn trademind.api.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --reload