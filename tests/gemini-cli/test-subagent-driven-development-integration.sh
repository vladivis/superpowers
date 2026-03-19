#!/usr/bin/env bash
# Integration Test for Gemini CLI: Fast Victory with Merge Wait
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "========================================================="
echo " Integration Test (Gemini): RELIABLE SWARM TEST"
echo "========================================================="

# 1. Setup Sandbox
TEST_PROJECT=$(mktemp -d)
echo "Sandbox: $TEST_PROJECT"
trap "rm -rf $TEST_PROJECT" EXIT

# 2. Copy the extension
cp -R "$ROOT_DIR/." "$TEST_PROJECT/"
cd "$TEST_PROJECT"
rm -rf .worktrees/* .swarm/* .git

# 3. Initialize Git
git init --quiet
git config user.email "test@test.com"
git config user.name "Test User"
mkdir -p src test docs/superpowers/plans

cat > package.json <<'EOF'
{
  "name": "reliable-swarm-test",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOF

cat > docs/superpowers/plans/implementation-plan.md <<'EOF'
# Test Plan
## Task 1: Create Add Function
Create function `add(a,b)` in `src/math.js`. Export it.
Tests: Create `test/math.test.js` verifying add(10, 5) is 15.
Verification: `npm test`
EOF

git add .
git commit -m "Initial commit" --quiet
node .gemini/task-polyfill/init_env.js

echo "Sandbox ready. Launching Gemini in background..."
echo "---------------------------------------------------------"

PROMPT="Execute the plan at docs/superpowers/plans/implementation-plan.md using subagent-driven-development. 
CRITICAL: You MUST use the subagent polyfill (node .gemini/task-polyfill/summon.js) to dispatch the task. 
Use 'auto' model. Choose the first option for all questions."

# Launch Gemini in background
gemini -p "$PROMPT" --yolo > agent.log 2>&1 &
AGENT_PID=$!

# 4. Polling for Completion AND Merge
echo "Waiting for subagent completion and parent merge..."
MAX_WAIT=600 
WAIT_COUNT=0
SUCCESS=0

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if subagent signal exists
    if ls .swarm/*.complete.json >/dev/null 2>&1; then
        # Now wait for the files to appear in the root (meaning parent merged them)
        if [ -f "src/math.js" ] && [ -f "test/math.test.js" ]; then
            echo ""
            echo "🏆 SUCCESS! Subagent finished and Parent merged the code."
            SUCCESS=1
            break
        fi
    fi
    
    printf "."
    sleep 5
    WAIT_COUNT=$((WAIT_COUNT + 5))
done

# Cleanup: Kill the parent agent process
kill $AGENT_PID 2>/dev/null || true

if [ $SUCCESS -eq 0 ]; then
    echo ""
    echo "❌ FAILED: Timeout or incomplete implementation."
    echo "--- Agent Logs ---"
    tail -n 30 agent.log
    exit 1
fi

echo "---------------------------------------------------------"
echo "Final Verification..."

FAILED=0
# Verify content
if grep -q "add" "src/math.js" && grep -q "15" "test/math.test.js"; then
    echo "  [PASS] Implementation and Tests are correct."
else
    echo "  [FAIL] Implementation content is wrong."
    FAILED=$((FAILED + 1))
fi

# Run the implemented tests
if npm test > /dev/null 2>&1; then
    echo "  [PASS] New tests passed successfully."
else
    echo "  [FAIL] New tests failed to run."
    FAILED=$((FAILED + 1))
fi

echo ""
if [ $FAILED -eq 0 ]; then
    echo "STATUS: PASSED 🏆 (TRUE ORCHESTRATION)"
    exit 0
else
    echo "STATUS: FAILED ❌"
    exit 1
fi
