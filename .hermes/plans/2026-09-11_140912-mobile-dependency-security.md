# BillManager Mobile Dependency Security Remediation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Remove or explicitly mitigate the 1 high and 7 moderate mobile dependency findings while preserving Expo SDK 57 compatibility and native build behavior.

**Architecture:** Treat Expo compatibility as the primary dependency constraint. Resolve the direct `image-size` exposure independently from the React Navigation/query-string chain, using targeted upgrades or overrides only after proving every parent accepts them. Do not use `npm audit fix --force` because its proposed navigation downgrade is a breaking and likely invalid remediation.

**Tech Stack:** Expo SDK 57, React Native 0.86, React Navigation 7, npm lockfile, Vitest, ESLint, TypeScript, Expo Doctor.

---

## Current context

- Audit baseline: 8 findings — 1 high, 7 moderate.
- High: direct dev dependency `image-size`; no fixed version is currently offered by npm audit for the ICNS/JXL/HEIF parser denial-of-service advisories.
- Moderate chain: `@react-navigation/*` → `query-string` → `decode-uri-component`.
- `npm audit fix` proposes `@react-navigation/native-stack@5.0.5`, a semver-major downgrade; do not apply it blindly.
- The current Expo compatibility gate passes 21/21 checks.

### Task 1: Map actual vulnerable-code reachability

**Objective:** Establish whether vulnerable parsers can process untrusted runtime or build-time input.

**Files:**
- Inspect: `apps/mobile/package.json`
- Inspect: `apps/mobile/package-lock.json`
- Inspect: `apps/mobile/scripts/`
- Inspect: `apps/mobile/plugins/`
- Inspect: `apps/mobile/widgets/`
- Create or update only if needed: `apps/mobile/audit-ci.jsonc`

**Steps:**
1. Run `npm explain image-size query-string decode-uri-component` from `apps/mobile`.
2. Search for imports/usages of `image-size` and identify every input source and accepted format.
3. Search navigation linking/configuration paths for attacker-controlled malformed URL decoding.
4. Record whether each advisory is runtime reachable, build-only reachable, or unreachable.
5. Do not create an exception until reachability and compensating controls are documented.

## Task 2: Remediate or contain `image-size`

**Objective:** Remove the high-severity parser exposure without weakening asset validation.

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Modify/test the exact image-validation script identified in Task 1

**Steps:**
1. Add a failing fixture test demonstrating rejection of ICNS, JXL, HEIF, oversized, and malformed inputs before parser invocation.
2. Prefer removing `image-size` if only PNG dimensions are needed; otherwise replace it with a maintained parser restricted to the project’s required formats.
3. If no safe replacement is compatible, constrain file extension, MIME signature, byte size, and processing timeout before parsing, then create a narrowly scoped, expiring audit exception.
4. Run the focused fixture test and confirm the malicious samples fail safely.
5. Run `npm audit --omit=dev --audit-level=high` and the repository policy audit separately.

## Task 3: Resolve the React Navigation chain

**Objective:** Eliminate the moderate URL-decoding findings without downgrading the navigation stack.

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Test: navigation/linking tests under `apps/mobile/src/**/__tests__/` or the nearest existing suite

**Steps:**
1. Check Expo SDK 57’s supported React Navigation ranges and current upstream releases.
2. Add malformed deep-link regression cases covering recursive/invalid percent encoding and bounded failure behavior.
3. Prefer compatible patch/minor upgrades of all direct `@react-navigation/*` packages as one set.
4. If parents accept a fixed transitive version, use a minimal npm override and verify with `npm explain`.
5. Reject any remediation that requires the audit-suggested v5 downgrade or breaks Expo compatibility.

## Task 4: Run the complete mobile gate

**Objective:** Prove dependency remediation does not regress generated code, native configuration, or bundling.

**Files:**
- Verify only unless generated drift is intentional

**Commands:**
```bash
cd apps/mobile
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run audit
rm -rf /tmp/billmanager-mobile-security-export
npx expo export --platform all --output-dir /tmp/billmanager-mobile-security-export
```

Expected: all checks and three platform bundles pass; no unaccepted high/critical finding remains; any moderate exception is documented with reachability, mitigation, owner, and expiry.

## Task 5: Run repository release gates

**Objective:** Verify the lockfile change against the monorepo’s broader release contract.

**Commands:**
```bash
make bootstrap
set -a; source .env; set +a
BACKEND_TEST_DB_EXTERNAL=1 make verify
docker build -t billmanager:dependency-remediation .
```

Also compare with `.github/workflows/build.yml` for mobile audit, generated drift, Expo compatibility, gitleaks, and Docker gates. Do not run EAS production builds or store submissions.

## Risks and open questions

- Expo’s supported dependency matrix can lag security releases.
- `image-size` may be build-only, but a high finding still needs removal or explicit bounded acceptance.
- Navigation upgrades can alter deep-link parsing and native screen behavior; signed-device validation remains external.
- Never use a production database or disclose `.env` values during verification.
