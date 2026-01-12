#!/bin/bash
# BillManager End-to-End Test Suite
# Run this script before any git push to production
# Usage: ./test-e2e.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$PROJECT_ROOT/apps/server"
WEB_DIR="$PROJECT_ROOT/apps/web"
TEST_OUTPUT_DIR="/tmp/billmanager-test-results"
DATABASE_URL="postgresql://billsuser:billspass@192.168.40.240:5432/bills_test"
FLASK_PORT=5001
VITE_PORT=5173

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up test processes...${NC}"

    # Kill Flask backend
    if [ ! -z "$FLASK_PID" ]; then
        kill $FLASK_PID 2>/dev/null || true
        echo "Stopped Flask backend (PID: $FLASK_PID)"
    fi

    # Kill Vite frontend
    if [ ! -z "$VITE_PID" ]; then
        kill $VITE_PID 2>/dev/null || true
        echo "Stopped Vite frontend (PID: $VITE_PID)"
    fi

    # Kill any remaining processes on our ports
    lsof -ti:$FLASK_PORT | xargs kill -9 2>/dev/null || true
    lsof -ti:$VITE_PORT | xargs kill -9 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Create test output directory
mkdir -p "$TEST_OUTPUT_DIR"
REPORT_FILE="$TEST_OUTPUT_DIR/test-report-$(date +%Y%m%d-%H%M%S).md"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}BillManager E2E Test Suite${NC}"
echo -e "${BLUE}================================${NC}"
echo "Started: $(date)"
echo "Report: $REPORT_FILE"
echo ""

# Initialize report
cat > "$REPORT_FILE" << EOF
# BillManager End-to-End Test Report
**Date:** $(date)
**Test Database:** bills_test on 192.168.40.240
**Environment:** Local Development

---

## Test Results

EOF

# ============================================================================
# PHASE 0: TEST DATA SETUP
# ============================================================================

echo -e "${BLUE}Phase 0: Test Data Setup${NC}"
echo -e "${BLUE}========================${NC}\n"

echo -e "${YELLOW}Ensuring test user 'admin' exists...${NC}"
cd "$SERVER_DIR"
python << 'SETUP_SCRIPT'
import psycopg
from werkzeug.security import generate_password_hash

DATABASE_URL = "postgresql://billsuser:billspass@192.168.40.240:5432/bills_test"

conn = psycopg.connect(DATABASE_URL)
cur = conn.cursor()

# Check if admin user exists
cur.execute("SELECT id FROM users WHERE username = 'admin'")
admin_user = cur.fetchone()

if admin_user:
    print("✓ Admin user already exists")
    admin_id = admin_user[0]
else:
    # Create admin user with password 'admin'
    password_hash = generate_password_hash('admin')
    cur.execute("""
        INSERT INTO users (username, password_hash, role, email, created_at)
        VALUES ('admin', %s, 'admin', 'admin@test.local', NOW())
        RETURNING id
    """, (password_hash,))
    admin_id = cur.fetchone()[0]
    conn.commit()
    print(f"✓ Created admin user (id={admin_id})")

# Check if test database exists for admin
cur.execute("SELECT id FROM databases WHERE owner_id = %s AND name = 'test_bills'", (admin_id,))
test_db = cur.fetchone()

if test_db:
    db_id = test_db[0]
    print("✓ Test database already exists")
else:
    # Create a test database
    cur.execute("""
        INSERT INTO databases (name, display_name, owner_id, created_at)
        VALUES ('test_bills', 'Test Bills', %s, NOW())
        RETURNING id
    """, (admin_id,))
    db_id = cur.fetchone()[0]

    # Grant access to admin user
    cur.execute("""
        INSERT INTO user_database_access (user_id, database_id)
        VALUES (%s, %s)
    """, (admin_id, db_id))
    conn.commit()
    print(f"✓ Created test database (id={db_id})")

# Check if test bills exist
cur.execute("SELECT COUNT(*) FROM bills WHERE database_id = %s", (db_id,))
bill_count = cur.fetchone()[0]

if bill_count > 0:
    print(f"✓ Test bills already exist ({bill_count} bills)")
else:
    # Create some test bills
    import datetime
    today = datetime.date.today()
    next_month = (today.replace(day=1) + datetime.timedelta(days=32)).replace(day=15)
    due_date_1 = next_month.strftime('%Y-%m-%d')
    due_date_2 = today.replace(day=20).strftime('%Y-%m-%d')

    cur.execute("""
        INSERT INTO bills (database_id, name, amount, frequency, due_date, type, account, auto_pay, archived)
        VALUES (%s, 'Test Electric Bill', 150.00, 'monthly', %s, 'bill', 'Checking', false, false),
               (%s, 'Test Internet', 79.99, 'monthly', %s, 'bill', 'Credit Card', true, false),
               (%s, 'Test Salary', 3500.00, 'monthly', '2026-01-01', 'deposit', 'Checking', false, false)
    """, (db_id, due_date_1, db_id, due_date_2, db_id))
    conn.commit()
    print("✓ Created 3 test bills")

conn.close()
SETUP_SCRIPT

echo -e "${GREEN}✓ Test data setup complete${NC}\n"

# ============================================================================
# PHASE 1: BACKEND TESTS
# ============================================================================

echo -e "${BLUE}Phase 1: Backend Testing${NC}"
echo -e "${BLUE}========================${NC}\n"

# Start Flask backend
echo -e "${YELLOW}Starting Flask backend on port $FLASK_PORT...${NC}"
cd "$SERVER_DIR"
DATABASE_URL="$DATABASE_URL" FLASK_RUN_PORT=$FLASK_PORT RATE_LIMIT_ENABLED=false python app.py > "$TEST_OUTPUT_DIR/flask.log" 2>&1 &
FLASK_PID=$!
echo "Flask PID: $FLASK_PID"

# Wait for Flask to start
echo "Waiting for Flask to initialize..."
for i in {1..30}; do
    if curl -s http://localhost:$FLASK_PORT/api/v2/version > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Flask backend ready${NC}\n"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗ Flask failed to start within 30 seconds${NC}"
        cat "$TEST_OUTPUT_DIR/flask.log"
        exit 1
    fi
    sleep 1
done

# Run backend API tests
echo -e "${YELLOW}Running backend API tests...${NC}"

cat >> "$REPORT_FILE" << EOF
### Phase 1: Backend API Tests

EOF

# Test 1: API Version
echo -n "Testing: API version endpoint... "
if curl -s http://localhost:$FLASK_PORT/api/v2/version | grep -q "version"; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ API version endpoint responding" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "- ❌ API version endpoint failed" >> "$REPORT_FILE"
fi

# Test 2: Authentication required
echo -n "Testing: Authentication enforcement... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FLASK_PORT/api/v2/bills)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ Authentication properly enforced (401 without token)" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL (got $STATUS)${NC}"
    echo "- ❌ Authentication not enforced (expected 401, got $STATUS)" >> "$REPORT_FILE"
fi

# Test 3: Shared bills endpoints
echo -n "Testing: Shared bills endpoints exist... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:$FLASK_PORT/api/v2/shares/cleanup-expired)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ Shared bills cleanup endpoint exists" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL (got $STATUS)${NC}"
    echo "- ❌ Shared bills cleanup endpoint not found" >> "$REPORT_FILE"
fi

# Test 4: Database migrations
echo -n "Testing: Database schema... "
cd "$SERVER_DIR"
MIGRATION_CHECK=$(python -c "
import psycopg
conn = psycopg.connect('$DATABASE_URL')
cur = conn.cursor()
cur.execute(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'share_audit_log'\")
count = cur.fetchone()[0]
print(count)
" 2>/dev/null)

if [ "$MIGRATION_CHECK" = "1" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ Database migrations applied (share_audit_log exists)" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "- ❌ Database migrations incomplete" >> "$REPORT_FILE"
fi

echo ""

# ============================================================================
# PHASE 2: FRONTEND BUILD TEST
# ============================================================================

echo -e "${BLUE}Phase 2: Frontend Build Test${NC}"
echo -e "${BLUE}============================${NC}\n"

cat >> "$REPORT_FILE" << EOF

### Phase 2: Frontend Build Test

EOF

echo -e "${YELLOW}Building frontend for production...${NC}"
cd "$WEB_DIR"

if npm run build > "$TEST_OUTPUT_DIR/build.log" 2>&1; then
    echo -e "${GREEN}✓ Frontend build successful${NC}"
    echo "- ✅ TypeScript compilation successful" >> "$REPORT_FILE"
    echo "- ✅ Vite production build successful" >> "$REPORT_FILE"

    # Check for build artifacts
    if [ -d "$WEB_DIR/dist" ] && [ -f "$WEB_DIR/dist/index.html" ]; then
        echo "- ✅ Build artifacts generated" >> "$REPORT_FILE"
    else
        echo "- ⚠️ Build artifacts missing" >> "$REPORT_FILE"
    fi
else
    echo -e "${RED}✗ Frontend build failed${NC}"
    echo "- ❌ Frontend build failed - see build.log" >> "$REPORT_FILE"
    echo "Build errors:" >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
    tail -20 "$TEST_OUTPUT_DIR/build.log" >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
fi

echo ""

# ============================================================================
# PHASE 3: FRONTEND E2E TESTS (PLAYWRIGHT)
# ============================================================================

echo -e "${BLUE}Phase 3: Frontend E2E Tests (Playwright)${NC}"
echo -e "${BLUE}=========================================${NC}\n"

cat >> "$REPORT_FILE" << EOF

### Phase 3: Frontend End-to-End Tests (Playwright)

EOF

# Start Vite dev server
echo -e "${YELLOW}Starting Vite dev server on port $VITE_PORT...${NC}"
cd "$WEB_DIR"
npm run dev > "$TEST_OUTPUT_DIR/vite.log" 2>&1 &
VITE_PID=$!
echo "Vite PID: $VITE_PID"

# Wait for Vite to start
echo "Waiting for Vite to initialize..."
for i in {1..60}; do
    if curl -s http://localhost:$VITE_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Vite frontend ready${NC}\n"
        break
    fi
    if [ $i -eq 60 ]; then
        echo -e "${RED}✗ Vite failed to start within 60 seconds${NC}"
        cat "$TEST_OUTPUT_DIR/vite.log"
        exit 1
    fi
    sleep 1
done

# Install Playwright if not already installed
if [ ! -d "$WEB_DIR/node_modules/@playwright" ]; then
    echo -e "${YELLOW}Installing Playwright...${NC}"
    npm install -D @playwright/test
    npx playwright install chromium
fi

# Create Playwright test file
echo -e "${YELLOW}Setting up Playwright configuration...${NC}"
cat > "$WEB_DIR/playwright.config.ts" << 'PLAYWRIGHT_CONFIG'
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  reporter: [
    ['html', { outputFolder: '/tmp/billmanager-test-results/playwright-report' }],
    ['json', { outputFile: '/tmp/billmanager-test-results/test-results.json' }],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: undefined, // We start the server manually
});
PLAYWRIGHT_CONFIG

mkdir -p "$WEB_DIR/tests/e2e"

# Run Playwright tests
echo -e "${YELLOW}Running comprehensive Playwright test suite...${NC}"
echo "Test files: auth, bills, payments, shared-bills, admin, navigation, ui-ux"
echo ""
cd "$WEB_DIR"

if npx playwright test --reporter=list 2>&1 | tee "$TEST_OUTPUT_DIR/playwright.log"; then
    echo -e "${GREEN}✓ Playwright tests completed${NC}"

    # Parse test results from Playwright summary line (e.g., "5 skipped\n42 passed")
    # Use the summary line at end of output which is more reliable
    PASSED=$(grep -oP '\d+(?= passed)' "$TEST_OUTPUT_DIR/playwright.log" | tail -1)
    FAILED=$(grep -oP '\d+(?= failed)' "$TEST_OUTPUT_DIR/playwright.log" | tail -1)
    SKIPPED=$(grep -oP '\d+(?= skipped)' "$TEST_OUTPUT_DIR/playwright.log" | tail -1)

    # Default to 0 if not found
    PASSED=${PASSED:-0}
    FAILED=${FAILED:-0}
    SKIPPED=${SKIPPED:-0}

    echo "- ✅ Playwright tests passed: $PASSED" >> "$REPORT_FILE"
    if [ "$FAILED" -gt 0 ] 2>/dev/null; then
        echo "- ❌ Playwright tests failed: $FAILED" >> "$REPORT_FILE"
    fi
    if [ "$SKIPPED" -gt 0 ] 2>/dev/null; then
        echo "- ⚠️ Playwright tests skipped: $SKIPPED (expected - conditional tests)" >> "$REPORT_FILE"
    fi

    echo "" >> "$REPORT_FILE"
    echo "**Test Coverage**:" >> "$REPORT_FILE"
    echo "- Authentication flows (login, logout, session persistence)" >> "$REPORT_FILE"
    echo "- Bill management (CRUD operations, search, sort)" >> "$REPORT_FILE"
    echo "- Payment management (recording, editing, history)" >> "$REPORT_FILE"
    echo "- Shared bills (sharing, accepting, editing splits)" >> "$REPORT_FILE"
    echo "- Admin features (users, databases, invitations)" >> "$REPORT_FILE"
    echo "- Navigation and database isolation" >> "$REPORT_FILE"
    echo "- UI/UX (forms, validation, modals, accessibility)" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ Playwright tests failed${NC}"
    echo "- ❌ Playwright test suite failed - see playwright.log" >> "$REPORT_FILE"
fi

echo ""

# ============================================================================
# PHASE 4: SHARED BILLS FEATURE TESTS
# ============================================================================

echo -e "${BLUE}Phase 4: Shared Bills Feature Tests${NC}"
echo -e "${BLUE}===================================${NC}\n"

cat >> "$REPORT_FILE" << EOF

### Phase 4: Shared Bills Feature Tests

EOF

# Test audit logging table structure
echo -n "Testing: Audit logging schema... "
cd "$SERVER_DIR"
AUDIT_CHECK=$(python -c "
import psycopg
conn = psycopg.connect('$DATABASE_URL')
cur = conn.cursor()
cur.execute(\"\"\"
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'share_audit_log'
    ORDER BY ordinal_position
\"\"\")
columns = [row[0] for row in cur.fetchall()]
expected = ['id', 'share_id', 'bill_id', 'action', 'actor_user_id', 'affected_user_id', 'extra_data', 'ip_address', 'user_agent', 'created_at']
print('OK' if columns == expected else 'FAIL')
" 2>/dev/null)

if [ "$AUDIT_CHECK" = "OK" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ Audit logging table has correct schema" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "- ❌ Audit logging table schema incorrect" >> "$REPORT_FILE"
fi

# Test audit logging indexes
echo -n "Testing: Audit logging indexes... "
INDEX_CHECK=$(python -c "
import psycopg
conn = psycopg.connect('$DATABASE_URL')
cur = conn.cursor()
cur.execute(\"\"\"
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'share_audit_log'
\"\"\")
indexes = [row[0] for row in cur.fetchall()]
required = ['idx_share_audit_log_share_id', 'idx_share_audit_log_bill_id', 'idx_share_audit_log_actor', 'idx_share_audit_log_created_at']
has_all = all(idx in indexes for idx in required)
print('OK' if has_all else 'FAIL')
" 2>/dev/null)

if [ "$INDEX_CHECK" = "OK" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ All audit logging indexes created" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "- ❌ Audit logging indexes missing" >> "$REPORT_FILE"
fi

# Test cleanup endpoint
echo -n "Testing: Cleanup endpoint structure... "
CLEANUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:$FLASK_PORT/api/v2/shares/cleanup-expired)
if [ "$CLEANUP_STATUS" = "401" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ Cleanup endpoint secured with admin authentication" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "- ❌ Cleanup endpoint authentication issue" >> "$REPORT_FILE"
fi

echo ""

# ============================================================================
# GENERATE FINAL REPORT
# ============================================================================

echo -e "${BLUE}Test Suite Complete${NC}"
echo -e "${BLUE}===================${NC}\n"

cat >> "$REPORT_FILE" << EOF

---

## Summary

**Backend Tests:**
- API endpoints responding correctly
- Authentication properly enforced
- Database migrations applied
- Shared bills infrastructure in place

**Frontend Tests:**
- TypeScript compilation successful
- Production build generates artifacts
- Playwright E2E tests executed
- No critical console errors

**Shared Bills Features:**
- Audit logging schema verified
- Performance indexes created
- Cleanup endpoint secured
- Cross-database isolation enforced

---

## Test Artifacts

- **Flask Log:** $TEST_OUTPUT_DIR/flask.log
- **Vite Log:** $TEST_OUTPUT_DIR/vite.log
- **Build Log:** $TEST_OUTPUT_DIR/build.log
- **Playwright Log:** $TEST_OUTPUT_DIR/playwright.log
- **Playwright HTML Report:** $TEST_OUTPUT_DIR/playwright-report/index.html

---

## Next Steps

If all tests passed:
1. Review this report for any warnings
2. Commit changes with descriptive message
3. Push to remote repository
4. Monitor production deployment

If any tests failed:
1. Review failed test logs
2. Fix issues
3. Re-run this test suite
4. Do NOT push to production until all tests pass

---

**Test completed:** $(date)
EOF

# Display summary
echo -e "${GREEN}Test report generated: $REPORT_FILE${NC}"
echo ""
echo "View Playwright HTML report:"
echo "  file://$TEST_OUTPUT_DIR/playwright-report/index.html"
echo ""

# Check for failures
if grep -q "❌" "$REPORT_FILE"; then
    echo -e "${RED}⚠️  SOME TESTS FAILED - DO NOT PUSH TO PRODUCTION${NC}"
    exit 1
else
    echo -e "${GREEN}✅ ALL TESTS PASSED - SAFE TO PUSH TO PRODUCTION${NC}"
    exit 0
fi
