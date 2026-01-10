# BillManager End-to-End Test Suite

## Overview

Comprehensive automated testing suite that validates backend APIs, frontend builds, and critical user paths before production deployment.

## Quick Start

```bash
# Run the full test suite
./test-e2e.sh

# Check exit code
echo $?  # 0 = all tests passed, 1 = some tests failed
```

## What Gets Tested

### Phase 1: Backend API Tests
- API version endpoint responding
- JWT authentication enforcement
- Shared bills cleanup endpoint exists
- Database migrations applied correctly
- Schema verification (tables, columns, indexes)

### Phase 2: Frontend Build Tests
- TypeScript compilation (no type errors)
- Vite production build succeeds
- Build artifacts generated in `apps/web/dist/`
- No unused imports or build warnings

### Phase 3: Frontend E2E Tests (Playwright)
- **Homepage**: Loads successfully with login form
- **Authentication**: Unauthenticated requests redirect to login
- **API Integration**: Backend endpoints accessible from frontend
- **Console Errors**: No React errors or warnings
- **Responsive Design**: Mobile viewport renders correctly
- **Accessibility**: Basic ARIA structure present

### Phase 4: Shared Bills Feature Tests
- Audit logging table structure correct
- Performance indexes created
- Cleanup endpoint secured with admin auth
- Cross-database isolation enforced

## Test Environment

| Component | Configuration |
|-----------|--------------|
| **Backend** | Flask on port 5001 |
| **Frontend** | Vite dev server on port 5173 |
| **Database** | `bills_test` on 192.168.40.240 |
| **Browser** | Chromium (Playwright) |
| **Output** | `/tmp/billmanager-test-results/` |

## Test Artifacts

After each run, the following artifacts are generated:

```
/tmp/billmanager-test-results/
├── test-report-YYYYMMDD-HHMMSS.md    # Main test report
├── flask.log                          # Backend logs
├── vite.log                           # Frontend dev server logs
├── build.log                          # Production build logs
├── playwright.log                     # E2E test execution logs
└── playwright-report/
    └── index.html                     # Interactive HTML report
```

### Viewing Results

**Test Report (Markdown)**:
```bash
cat /tmp/billmanager-test-results/test-report-*.md
```

**Playwright HTML Report (Interactive)**:
```bash
# Open in browser
xdg-open /tmp/billmanager-test-results/playwright-report/index.html

# Or navigate to:
file:///tmp/billmanager-test-results/playwright-report/index.html
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| `0` | All tests passed | ✅ Safe to push to production |
| `1` | Some tests failed | ❌ Review logs, fix issues, re-run |

## Troubleshooting

### Port Already in Use

If Flask (5001) or Vite (5173) ports are busy:

```bash
# Kill processes on ports
lsof -ti:5001 | xargs kill -9
lsof -ti:5173 | xargs kill -9

# Or stop Docker containers
docker stop $(docker ps -q --filter "publish=5001")
docker stop $(docker ps -q --filter "publish=5173")
```

### Database Connection Failed

Ensure PostgreSQL is running and accessible:

```bash
# Test connection
psql postgresql://billsuser:billspass@192.168.40.240:5432/bills_test -c "SELECT 1"

# Check if database exists
psql postgresql://billsuser:billspass@192.168.40.240:5432/postgres -c "\l" | grep bills_test
```

### Playwright Not Installed

The script auto-installs Playwright, but if issues persist:

```bash
cd apps/web
npm install -D @playwright/test
npx playwright install chromium
```

### Flask Fails to Start

Check logs for errors:

```bash
cat /tmp/billmanager-test-results/flask.log
```

Common issues:
- Missing dependencies: `pip install -r apps/server/requirements.txt`
- Database connection: Verify `DATABASE_URL`
- Port conflict: Kill process on 5001

### Vite Fails to Start

Check logs for errors:

```bash
cat /tmp/billmanager-test-results/vite.log
```

Common issues:
- Missing dependencies: `cd apps/web && npm install`
- Port conflict: Kill process on 5173
- Build errors: Check `build.log`

## Extending Tests

### Adding Backend API Tests

Edit `test-e2e.sh` in the "Phase 1: Backend Tests" section:

```bash
echo -n "Testing: Your new test... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FLASK_PORT/api/v2/your-endpoint)
if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    echo "- ✅ Your test passed" >> "$REPORT_FILE"
else
    echo -e "${RED}✗ FAIL${NC}"
    echo "- ❌ Your test failed" >> "$REPORT_FILE"
fi
```

### Adding Playwright E2E Tests

Edit `apps/web/tests/e2e/critical-paths.spec.ts`:

```typescript
test('your new test', async ({ page }) => {
  await page.goto('/your-page');

  // Your test assertions
  await expect(page.locator('text=Your Content')).toBeVisible();
});
```

### Adding Feature-Specific Tests

Edit `test-e2e.sh` in the "Phase 4: Feature Tests" section to add database queries or endpoint tests specific to your feature.

## Integration with CI/CD

### GitHub Actions

Add to `.github/workflows/test.yml`:

```yaml
name: Test Suite

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run test suite
        run: ./test-e2e.sh
```

### Pre-Commit Hook

Create `.git/hooks/pre-push`:

```bash
#!/bin/bash
echo "Running test suite before push..."
./test-e2e.sh

if [ $? -ne 0 ]; then
    echo "Tests failed. Push aborted."
    exit 1
fi
```

Make executable:
```bash
chmod +x .git/hooks/pre-push
```

## Best Practices

1. **Always run before pushing**: Make it a habit to run `./test-e2e.sh` before `git push`

2. **Review all test artifacts**: Don't just check the exit code—review the generated report and Playwright HTML report

3. **Keep tests fast**: The suite should complete in under 5 minutes. If it gets slower, optimize.

4. **Update tests with features**: When adding new features, add corresponding tests to the suite

5. **Clean test database**: Periodically reset the test database to ensure tests run with clean state

## Manual Testing Complement

Automated tests don't cover everything. After tests pass, manually verify:

- **UI/UX flows**: Visual appearance, animations, responsive design
- **Edge cases**: Boundary conditions, unusual input
- **Cross-browser**: Test in Firefox, Safari (Playwright only tests Chromium)
- **Mobile devices**: Test on real Android/iOS devices
- **Performance**: Load time, responsiveness with large datasets

## Support

If you encounter issues with the test suite:

1. Check logs in `/tmp/billmanager-test-results/`
2. Review the troubleshooting section above
3. Ensure all dependencies are installed
4. Try running individual phases manually to isolate issues

## Version History

- **v1.0** (2026-01-09): Initial comprehensive test suite
  - Backend API tests
  - Frontend build validation
  - Playwright E2E tests
  - Shared bills feature tests
