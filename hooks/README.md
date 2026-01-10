# Git Hooks for BillManager

This directory contains optional Git hooks that enhance development workflow.

## Available Hooks

### pre-push

Automatically runs the full end-to-end test suite before pushing to remote repository.

**What it does:**
- Runs `./test-e2e.sh` before every `git push`
- Aborts push if any tests fail
- Ensures only tested code reaches production

**Installation:**

```bash
# From repository root
cp hooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

**Usage:**

After installation, the hook runs automatically:

```bash
git push origin main
# → Automatically runs test suite
# → Push proceeds only if tests pass
```

**Bypass (emergency only):**

```bash
git push --no-verify
```

⚠️ **Warning**: Only bypass the hook in emergencies. Pushing untested code can break production.

## Why Use Hooks?

**Benefits:**
- Catches issues before they reach production
- Enforces testing discipline
- Reduces broken deployments
- Saves time by catching errors early

**When to bypass:**
- Hotfix for critical production issue
- Non-code changes (docs, configs)
- Working on a feature branch (not pushing to main)

## Hook Development

### Adding New Hooks

1. Create hook script in `hooks/` directory
2. Make it executable: `chmod +x hooks/your-hook`
3. Document in this README
4. Users install with: `cp hooks/your-hook .git/hooks/your-hook`

### Testing Hooks Locally

```bash
# Test pre-push hook without actually pushing
.git/hooks/pre-push
echo $?  # Should be 0 if tests pass
```

## Git Hooks Reference

Common Git hooks you can create:

| Hook | Runs | Use Case |
|------|------|----------|
| `pre-commit` | Before each commit | Linting, formatting |
| `pre-push` | Before each push | **Full test suite** ✅ |
| `post-merge` | After git pull/merge | Dependency updates |
| `commit-msg` | Before commit message | Enforce message format |

## Troubleshooting

### Hook Not Running

Verify installation:
```bash
ls -la .git/hooks/pre-push
# Should show executable permissions: -rwxr-xr-x
```

Re-install if needed:
```bash
cp hooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

### Hook Failing

Check what's wrong:
```bash
# Run hook manually to see output
.git/hooks/pre-push

# Review test results
cat /tmp/billmanager-test-results/test-report-*.md
```

### Disable Hook Temporarily

```bash
# Rename to disable
mv .git/hooks/pre-push .git/hooks/pre-push.disabled

# Rename back to enable
mv .git/hooks/pre-push.disabled .git/hooks/pre-push
```

## Best Practices

1. **Install hooks for main/production branches**: Protect important branches
2. **Keep hooks fast**: Slow hooks frustrate developers
3. **Make hooks optional**: Check into `hooks/`, let developers install
4. **Document bypass procedures**: For emergency situations
5. **Test hooks regularly**: Ensure they still work after repo changes
