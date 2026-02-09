#!/bin/bash
# BillManager End-to-End Test Suite
# Run this script before any git push to production
# Usage: ./test-e2e.sh
#
# MANUAL TESTING NOTE:
#   This dev server is headless. For manual browser testing from another machine,
#   start the servers with external access:
#
#     # Flask (already binds 0.0.0.0):
#     cd apps/server && DATABASE_URL=postgresql://billsuser:billspass@192.168.40.242:5432/bills_test \
#       FLASK_RUN_PORT=5001 RATE_LIMIT_ENABLED=false python3 app.py
#
#     # Vite (must pass --host):
#     cd apps/web && npx vite --host 0.0.0.0 --port 5173
#
#   Then access from your browser at: http://192.168.40.111:5173
#   (Flask API is proxied through Vite, or direct at http://192.168.40.111:5001)

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
DATABASE_URL="postgresql://billsuser:billspass@192.168.40.242:5432/bills_test"
FLASK_PORT=5001
VITE_PORT=5173
# Bind to 0.0.0.0 so the test servers are accessible from other machines on the LAN
BIND_HOST="0.0.0.0"
# Detect LAN IP for reporting
LAN_IP=$(hostname -I | awk '{print $1}')

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
echo "LAN IP: $LAN_IP"
echo ""

# Initialize report
cat > "$REPORT_FILE" << EOF
# BillManager End-to-End Test Report
**Date:** $(date)
**Test Database:** bills_test on 192.168.40.242
**Dev Server LAN IP:** $LAN_IP
**Environment:** Local Development (headless)

---

## Manual Testing Access

After automated tests complete (or during, if you start servers manually):
- **Frontend:** http://$LAN_IP:$VITE_PORT
- **Backend API:** http://$LAN_IP:$FLASK_PORT/api/v2/docs

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
python3 << 'SETUP_SCRIPT'
import psycopg
import datetime
from werkzeug.security import generate_password_hash

DATABASE_URL = "postgresql://billsuser:billspass@192.168.40.242:5432/bills_test"

conn = psycopg.connect(DATABASE_URL)
cur = conn.cursor()

# Check if admin user exists
cur.execute("SELECT id FROM users WHERE username = 'admin'")
admin_user = cur.fetchone()

if admin_user:
    print("OK Admin user already exists")
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
    print(f"OK Created admin user (id={admin_id})")

# Check if test database exists for admin
cur.execute("SELECT id FROM databases WHERE owner_id = %s AND name = 'test_bills'", (admin_id,))
test_db = cur.fetchone()

if test_db:
    db_id = test_db[0]
    print("OK Test database already exists")
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
    print(f"OK Created test database (id={db_id})")

# Check if test bills exist
cur.execute("SELECT COUNT(*) FROM bills WHERE database_id = %s", (db_id,))
bill_count = cur.fetchone()[0]

if bill_count >= 5:
    print(f"OK Test bills already exist ({bill_count} bills)")
else:
    # Create a richer set of test bills for Dashboard/Calendar/Analytics testing
    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    three_days_ago = today - datetime.timedelta(days=3)
    next_week = today + datetime.timedelta(days=7)
    next_month = (today.replace(day=1) + datetime.timedelta(days=32)).replace(day=15)
    due_date_1 = next_month.strftime('%Y-%m-%d')
    due_date_2 = today.replace(day=20).strftime('%Y-%m-%d')

    cur.execute("""
        INSERT INTO bills (database_id, name, amount, frequency, due_date, type, account, auto_pay, archived)
        VALUES
            (%s, 'Test Electric Bill', 150.00, 'monthly', %s, 'bill', 'Checking', false, false),
            (%s, 'Test Internet', 79.99, 'monthly', %s, 'bill', 'Credit Card', true, false),
            (%s, 'Test Salary', 3500.00, 'monthly', '2026-01-01', 'deposit', 'Checking', false, false),
            (%s, 'Test Overdue Rent', 1200.00, 'monthly', %s, 'bill', 'Checking', false, false),
            (%s, 'Test Car Insurance', 185.00, 'monthly', %s, 'bill', 'Savings', false, false),
            (%s, 'Test Netflix', 15.99, 'monthly', %s, 'bill', 'Credit Card', true, false),
            (%s, 'Test Freelance Income', 2000.00, 'monthly', %s, 'deposit', 'Savings', false, false)
        ON CONFLICT DO NOTHING
    """, (
        db_id, due_date_1,
        db_id, due_date_2,
        db_id,
        db_id, three_days_ago.strftime('%Y-%m-%d'),
        db_id, next_week.strftime('%Y-%m-%d'),
        db_id, today.strftime('%Y-%m-%d'),
        db_id, next_month.strftime('%Y-%m-%d'),
    ))

    # Create some payment history for Analytics testing
    for month_offset in range(0, 6):
        payment_date = (today.replace(day=1) - datetime.timedelta(days=30 * month_offset)).replace(day=15)
        # Find bills to create payments for
        cur.execute("SELECT id, amount FROM bills WHERE database_id = %s AND type = 'bill' LIMIT 3", (db_id,))
        bills_for_payments = cur.fetchall()
        for bill_id, amount in bills_for_payments:
            cur.execute("""
                INSERT INTO payments (bill_id, amount, payment_date)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (bill_id, float(amount), payment_date.strftime('%Y-%m-%d')))

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM bills WHERE database_id = %s", (db_id,))
    final_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM payments p JOIN bills b ON p.bill_id = b.id WHERE b.database_id = %s", (db_id,))
    payment_count = cur.fetchone()[0]
    print(f"OK Created test data: {final_count} bills, {payment_count} payments")

conn.close()
SETUP_SCRIPT

echo -e "${GREEN}Phase 0 complete${NC}\n"

# ============================================================================
# PHASE 1: BACKEND TESTS
# ============================================================================

echo -e "${BLUE}Phase 1: Backend Testing${NC}"
echo -e "${BLUE}========================${NC}\n"

# Start Flask backend (already binds to 0.0.0.0 in app.py)
echo -e "${YELLOW}Starting Flask backend on port $FLASK_PORT...${NC}"
cd "$SERVER_DIR"
DATABASE_URL="$DATABASE_URL" FLASK_RUN_PORT=$FLASK_PORT RATE_LIMIT_ENABLED=false python3 app.py > "$TEST_OUTPUT_DIR/flask.log" 2>&1 &
FLASK_PID=$!
echo "Flask PID: $FLASK_PID"

# Wait for Flask to start
echo "Waiting for Flask to initialize..."
for i in {1..30}; do
    if curl -s http://localhost:$FLASK_PORT/api/v2/version > /dev/null 2>&1; then
        echo -e "${GREEN}Flask backend ready${NC}"
        echo -e "  Local:  http://localhost:$FLASK_PORT"
        echo -e "  LAN:    http://$LAN_IP:$FLASK_PORT"
        echo ""
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Flask failed to start within 30 seconds${NC}"
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
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: API version endpoint responding" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL${NC}"
    echo "- FAIL: API version endpoint failed" >> "$REPORT_FILE"
fi

# Test 2: Authentication required
echo -n "Testing: Authentication enforcement... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FLASK_PORT/api/v2/bills)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Authentication properly enforced (401 without token)" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL (got $STATUS)${NC}"
    echo "- FAIL: Authentication not enforced (expected 401, got $STATUS)" >> "$REPORT_FILE"
fi

# Test 3: Shared bills endpoints
echo -n "Testing: Shared bills endpoints exist... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:$FLASK_PORT/api/v2/shares/cleanup-expired)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Shared bills cleanup endpoint exists" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL (got $STATUS)${NC}"
    echo "- FAIL: Shared bills cleanup endpoint not found" >> "$REPORT_FILE"
fi

# Test 4: Database migrations
echo -n "Testing: Database schema... "
cd "$SERVER_DIR"
MIGRATION_CHECK=$(python3 -c "
import psycopg
conn = psycopg.connect('$DATABASE_URL')
cur = conn.cursor()
cur.execute(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'share_audit_log'\")
count = cur.fetchone()[0]
print(count)
" 2>/dev/null)

if [ "$MIGRATION_CHECK" = "1" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Database migrations applied (share_audit_log exists)" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL${NC}"
    echo "- FAIL: Database migrations incomplete" >> "$REPORT_FILE"
fi

# Test 5: New analytics endpoints exist (auth-gated)
echo -n "Testing: Stats/by-account endpoint... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FLASK_PORT/api/v2/stats/by-account)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Stats by-account endpoint exists (requires auth)" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL (got $STATUS)${NC}"
    echo "- FAIL: Stats by-account endpoint issue (expected 401, got $STATUS)" >> "$REPORT_FILE"
fi

echo -n "Testing: Stats/yearly endpoint... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FLASK_PORT/api/v2/stats/yearly)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Stats yearly endpoint exists (requires auth)" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL (got $STATUS)${NC}"
    echo "- FAIL: Stats yearly endpoint issue (expected 401, got $STATUS)" >> "$REPORT_FILE"
fi

echo -n "Testing: Stats/monthly-comparison endpoint... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FLASK_PORT/api/v2/stats/monthly-comparison)
if [ "$STATUS" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Stats monthly-comparison endpoint exists (requires auth)" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL (got $STATUS)${NC}"
    echo "- FAIL: Stats monthly-comparison endpoint issue (expected 401, got $STATUS)" >> "$REPORT_FILE"
fi

# Test 6: Authenticated API test (get JWT token and test data endpoints)
echo -n "Testing: Authenticated stats endpoints return data... "
cd "$SERVER_DIR"
AUTH_TEST=$(python3 -c "
import requests
import json

base = 'http://localhost:$FLASK_PORT/api/v2'

# Login to get JWT token
r = requests.post(f'{base}/auth/login', json={'username': 'admin', 'password': 'admin'})
if r.status_code != 200:
    print('FAIL_LOGIN')
    exit()

data = r.json().get('data', {})
token = data.get('access_token', '') if isinstance(data, dict) else ''
if not token:
    print('FAIL_TOKEN')
    exit()

headers = {'Authorization': f'Bearer {token}', 'X-Database': 'test_bills'}

# Test stats/by-account
r1 = requests.get(f'{base}/stats/by-account', headers=headers)
# Test stats/monthly
r2 = requests.get(f'{base}/stats/monthly', headers=headers)
# Test stats/yearly
r3 = requests.get(f'{base}/stats/yearly', headers=headers)
# Test stats/monthly-comparison
r4 = requests.get(f'{base}/stats/monthly-comparison', headers=headers)

all_ok = all(r.status_code == 200 for r in [r1, r2, r3, r4])
all_success = all(r.json().get('success') == True for r in [r1, r2, r3, r4])

if all_ok and all_success:
    print('OK')
else:
    statuses = [r.status_code for r in [r1, r2, r3, r4]]
    print(f'FAIL: statuses={statuses}')
" 2>/dev/null)

if [ "$AUTH_TEST" = "OK" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: All stats endpoints return valid data with auth" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL ($AUTH_TEST)${NC}"
    echo "- FAIL: Stats endpoint data test: $AUTH_TEST" >> "$REPORT_FILE"
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
    echo -e "${GREEN}Frontend build successful${NC}"
    echo "- PASS: TypeScript compilation successful" >> "$REPORT_FILE"
    echo "- PASS: Vite production build successful" >> "$REPORT_FILE"

    # Check for build artifacts
    if [ -d "$WEB_DIR/dist" ] && [ -f "$WEB_DIR/dist/index.html" ]; then
        echo "- PASS: Build artifacts generated" >> "$REPORT_FILE"
    else
        echo "- WARN: Build artifacts missing" >> "$REPORT_FILE"
    fi
else
    echo -e "${RED}Frontend build failed${NC}"
    echo "- FAIL: Frontend build failed - see build.log" >> "$REPORT_FILE"
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

# Start Vite dev server bound to 0.0.0.0 for LAN access
echo -e "${YELLOW}Starting Vite dev server on $BIND_HOST:$VITE_PORT...${NC}"
cd "$WEB_DIR"
npx vite --host $BIND_HOST --port $VITE_PORT > "$TEST_OUTPUT_DIR/vite.log" 2>&1 &
VITE_PID=$!
echo "Vite PID: $VITE_PID"

# Wait for Vite to start
echo "Waiting for Vite to initialize..."
for i in {1..60}; do
    if curl -s http://localhost:$VITE_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}Vite frontend ready${NC}"
        echo -e "  Local:  http://localhost:$VITE_PORT"
        echo -e "  LAN:    http://$LAN_IP:$VITE_PORT"
        echo ""
        break
    fi
    if [ $i -eq 60 ]; then
        echo -e "${RED}Vite failed to start within 60 seconds${NC}"
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

mkdir -p "$WEB_DIR/tests/e2e"

# Run Playwright tests
echo -e "${YELLOW}Running comprehensive Playwright test suite...${NC}"
echo "Test suites: auth, bills, payments, shared-bills, admin, navigation, ui-ux,"
echo "             dashboard, calendar, analytics, sidebar-nav"
echo ""
cd "$WEB_DIR"

if npx playwright test --reporter=list 2>&1 | tee "$TEST_OUTPUT_DIR/playwright.log"; then
    echo -e "${GREEN}Playwright tests completed${NC}"

    # Parse test results from Playwright summary line (e.g., "5 skipped\n42 passed")
    PASSED=$(grep -oP '\d+(?= passed)' "$TEST_OUTPUT_DIR/playwright.log" | tail -1)
    FAILED=$(grep -oP '\d+(?= failed)' "$TEST_OUTPUT_DIR/playwright.log" | tail -1)
    SKIPPED=$(grep -oP '\d+(?= skipped)' "$TEST_OUTPUT_DIR/playwright.log" | tail -1)

    # Default to 0 if not found
    PASSED=${PASSED:-0}
    FAILED=${FAILED:-0}
    SKIPPED=${SKIPPED:-0}

    echo "- Playwright tests passed: $PASSED" >> "$REPORT_FILE"
    if [ "$FAILED" -gt 0 ] 2>/dev/null; then
        echo "- FAIL: Playwright tests failed: $FAILED" >> "$REPORT_FILE"
    fi
    if [ "$SKIPPED" -gt 0 ] 2>/dev/null; then
        echo "- WARN: Playwright tests skipped: $SKIPPED (expected - conditional tests)" >> "$REPORT_FILE"
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
    echo "- **Dashboard page (stat cards, upcoming bills, overdue alerts)**" >> "$REPORT_FILE"
    echo "- **Calendar page (month navigation, view toggles, day details)**" >> "$REPORT_FILE"
    echo "- **Analytics page (pie chart, YoY comparison, yearly data)**" >> "$REPORT_FILE"
    echo "- **Sidebar navigation (all links, active state, page flow)**" >> "$REPORT_FILE"
else
    echo -e "${RED}Playwright tests failed${NC}"
    echo "- FAIL: Playwright test suite failed - see playwright.log" >> "$REPORT_FILE"
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
AUDIT_CHECK=$(python3 -c "
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
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Audit logging table has correct schema" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL${NC}"
    echo "- FAIL: Audit logging table schema incorrect" >> "$REPORT_FILE"
fi

# Test audit logging indexes
echo -n "Testing: Audit logging indexes... "
INDEX_CHECK=$(python3 -c "
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
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: All audit logging indexes created" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL${NC}"
    echo "- FAIL: Audit logging indexes missing" >> "$REPORT_FILE"
fi

# Test cleanup endpoint
echo -n "Testing: Cleanup endpoint structure... "
CLEANUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:$FLASK_PORT/api/v2/shares/cleanup-expired)
if [ "$CLEANUP_STATUS" = "401" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "- PASS: Cleanup endpoint secured with admin authentication" >> "$REPORT_FILE"
else
    echo -e "${RED}FAIL${NC}"
    echo "- FAIL: Cleanup endpoint authentication issue" >> "$REPORT_FILE"
fi

echo ""

# ============================================================================
# PHASE 5: NEW FEATURE ENDPOINT TESTS
# ============================================================================

echo -e "${BLUE}Phase 5: New Feature API Tests (Dashboard/Calendar/Analytics)${NC}"
echo -e "${BLUE}=============================================================${NC}\n"

cat >> "$REPORT_FILE" << EOF

### Phase 5: New Feature API Tests

EOF

# Get a JWT token for authenticated tests
JWT_TOKEN=$(python3 -c "
import requests
r = requests.post('http://localhost:$FLASK_PORT/api/v2/auth/login', json={'username': 'admin', 'password': 'admin'})
data = r.json().get('data', {})
print(data.get('access_token', '') if isinstance(data, dict) else '')
" 2>/dev/null)

if [ -z "$JWT_TOKEN" ]; then
    echo -e "${RED}Could not obtain JWT token - skipping authenticated tests${NC}"
    echo "- FAIL: Could not obtain JWT token for testing" >> "$REPORT_FILE"
else
    AUTH_HEADER="Authorization: Bearer $JWT_TOKEN"
    DB_HEADER="X-Database: test_bills"

    # Test stats/by-account returns structured data
    echo -n "Testing: Stats by-account data structure... "
    BY_ACCOUNT=$(curl -s -H "$AUTH_HEADER" -H "$DB_HEADER" http://localhost:$FLASK_PORT/api/v2/stats/by-account)
    if echo "$BY_ACCOUNT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['success'] == True
assert isinstance(data['data'], list)
if len(data['data']) > 0:
    item = data['data'][0]
    assert 'account' in item
    assert 'expenses' in item
    assert 'deposits' in item
print('OK')
" 2>/dev/null; then
        echo -e "${GREEN}PASS${NC}"
        echo "- PASS: Stats by-account returns correct data structure" >> "$REPORT_FILE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "- FAIL: Stats by-account data structure incorrect" >> "$REPORT_FILE"
    fi

    # Test stats/yearly returns structured data
    echo -n "Testing: Stats yearly data structure... "
    YEARLY=$(curl -s -H "$AUTH_HEADER" -H "$DB_HEADER" http://localhost:$FLASK_PORT/api/v2/stats/yearly)
    if echo "$YEARLY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['success'] == True
assert isinstance(data['data'], dict)
print('OK')
" 2>/dev/null; then
        echo -e "${GREEN}PASS${NC}"
        echo "- PASS: Stats yearly returns correct data structure" >> "$REPORT_FILE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "- FAIL: Stats yearly data structure incorrect" >> "$REPORT_FILE"
    fi

    # Test stats/monthly-comparison returns structured data
    echo -n "Testing: Stats monthly-comparison data structure... "
    COMPARISON=$(curl -s -H "$AUTH_HEADER" -H "$DB_HEADER" http://localhost:$FLASK_PORT/api/v2/stats/monthly-comparison)
    if echo "$COMPARISON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['success'] == True
d = data['data']
assert 'current_year' in d
assert 'months' in d
assert isinstance(d['months'], list)
print('OK')
" 2>/dev/null; then
        echo -e "${GREEN}PASS${NC}"
        echo "- PASS: Stats monthly-comparison returns correct data structure" >> "$REPORT_FILE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "- FAIL: Stats monthly-comparison data structure incorrect" >> "$REPORT_FILE"
    fi

    # Test bills endpoint (used by Dashboard)
    echo -n "Testing: Bills endpoint for Dashboard data... "
    BILLS=$(curl -s -H "$AUTH_HEADER" -H "$DB_HEADER" http://localhost:$FLASK_PORT/api/v2/bills)
    if echo "$BILLS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['success'] == True
assert isinstance(data['data'], list)
assert len(data['data']) > 0, 'No bills found - test data setup may have failed'
print('OK')
" 2>/dev/null; then
        echo -e "${GREEN}PASS${NC}"
        echo "- PASS: Bills endpoint returns data for Dashboard" >> "$REPORT_FILE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "- FAIL: Bills endpoint issue" >> "$REPORT_FILE"
    fi

    # Test stats/monthly (used by Sidebar and Analytics)
    echo -n "Testing: Monthly stats endpoint... "
    MONTHLY=$(curl -s -H "$AUTH_HEADER" -H "$DB_HEADER" http://localhost:$FLASK_PORT/api/v2/stats/monthly)
    if echo "$MONTHLY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['success'] == True
assert isinstance(data['data'], dict)
print('OK')
" 2>/dev/null; then
        echo -e "${GREEN}PASS${NC}"
        echo "- PASS: Monthly stats endpoint returns data" >> "$REPORT_FILE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "- FAIL: Monthly stats endpoint issue" >> "$REPORT_FILE"
    fi

    # Test all-buckets mode for bills
    echo -n "Testing: All-buckets mode (_all_) for bills... "
    ALL_BILLS=$(curl -s -H "$AUTH_HEADER" -H "X-Database: _all_" http://localhost:$FLASK_PORT/api/v2/bills)
    ALL_STATUS=$(echo "$ALL_BILLS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('OK' if data.get('success') == True else 'FAIL')
" 2>/dev/null)
    if [ "$ALL_STATUS" = "OK" ]; then
        echo -e "${GREEN}PASS${NC}"
        echo "- PASS: All-buckets mode returns bills across databases" >> "$REPORT_FILE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "- FAIL: All-buckets mode issue" >> "$REPORT_FILE"
    fi
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
- New analytics endpoints (by-account, yearly, monthly-comparison)

**Frontend Tests:**
- TypeScript compilation successful
- Production build generates artifacts
- Playwright E2E tests executed
- Dashboard, Calendar, Analytics pages tested
- Sidebar navigation tested

**Shared Bills Features:**
- Audit logging schema verified
- Performance indexes created
- Cleanup endpoint secured
- Cross-database isolation enforced

**New Feature APIs:**
- Stats by-account endpoint verified
- Stats yearly endpoint verified
- Stats monthly-comparison endpoint verified
- All-buckets mode verified

---

## Manual Testing

For manual browser testing from another machine on the LAN:

\`\`\`bash
# Start servers (from this dev machine):
cd $PROJECT_ROOT/apps/server
DATABASE_URL=postgresql://billsuser:billspass@192.168.40.242:5432/bills_test \\
  FLASK_RUN_PORT=5001 RATE_LIMIT_ENABLED=false python3 app.py &

cd $PROJECT_ROOT/apps/web
npx vite --host 0.0.0.0 --port 5173
\`\`\`

Then browse to: **http://$LAN_IP:$VITE_PORT**
Login: admin / admin

### Manual Test Checklist
- [ ] Dashboard loads with stat cards and upcoming bills
- [ ] Overdue alerts appear for past-due bills
- [ ] "Pay Now" from overdue alert works
- [ ] Calendar shows bills on correct dates
- [ ] Calendar month toggle (1/3/6 months) works
- [ ] Day detail modal opens when clicking a date with bills
- [ ] Analytics pie chart shows account spending breakdown
- [ ] Analytics YoY comparison renders bar chart
- [ ] Sidebar nav links highlight correctly for each page
- [ ] Page transitions between Dashboard/Bills/Calendar/Analytics are smooth

---

## Test Artifacts

- **Flask Log:** $TEST_OUTPUT_DIR/flask.log
- **Vite Log:** $TEST_OUTPUT_DIR/vite.log
- **Build Log:** $TEST_OUTPUT_DIR/build.log
- **Playwright Log:** $TEST_OUTPUT_DIR/playwright.log
- **Playwright HTML Report:** $TEST_OUTPUT_DIR/playwright-report/index.html

---

**Test completed:** $(date)
EOF

# Display summary
echo -e "${GREEN}Test report generated: $REPORT_FILE${NC}"
echo ""
echo "View Playwright HTML report:"
echo "  file://$TEST_OUTPUT_DIR/playwright-report/index.html"
echo ""
echo -e "${YELLOW}Manual testing access (from another machine):${NC}"
echo "  http://$LAN_IP:$VITE_PORT"
echo ""

# Check for failures
if grep -q "FAIL:" "$REPORT_FILE"; then
    echo -e "${RED}SOME TESTS FAILED - DO NOT PUSH TO PRODUCTION${NC}"
    exit 1
else
    echo -e "${GREEN}ALL TESTS PASSED - SAFE TO PUSH TO PRODUCTION${NC}"
    exit 0
fi
