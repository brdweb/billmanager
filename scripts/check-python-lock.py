#!/usr/bin/env python3
"""Validate committed Python pins without upgrading to newer releases.

Resolve the manifest with the lock as constraints and compare package sets.
This project's lock format is one exact, unconditional pin per line, plus
comments. Reject unsupported syntax rather than silently ignoring it.
"""
import argparse
import difflib
from pathlib import Path
import re
import subprocess
import tempfile


def pins(path):
    result = {}
    for line in path.read_text().splitlines():
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([A-Za-z0-9.!+_-]+)', line)
        if not match:
            raise ValueError(f'{path}: expected an exact unconditional pin: {line}')
        name = re.sub(r'[-_.]+', '-', match[1]).lower()
        if name in result:
            raise ValueError(f'{path}: duplicate pin: {name}')
        result[name] = match[2]
    return sorted(f'{name}=={version}\n' for name, version in result.items())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--requirements', type=Path, default=Path('apps/server/requirements.txt'))
    parser.add_argument('--lock', type=Path, default=Path('apps/server/requirements.lock'))
    args = parser.parse_args()
    try:
        expected = pins(args.lock)
        with tempfile.TemporaryDirectory(prefix='billmanager-lock-') as directory:
            output = Path(directory) / 'resolved.txt'
            subprocess.run([
                'uv', 'pip', 'compile', str(args.requirements),
                '--constraint', str(args.lock), '--python-version', '3.14',
                '--no-header', '--no-annotate', '--output-file', str(output),
                '--quiet',
            ], check=True)
            actual = pins(output)
        if expected != actual:
            print(''.join(difflib.unified_diff(expected, actual, fromfile='committed lock', tofile='resolved graph')), end='')
            print('Lock package set is stale; regenerate and review the dependency update.')
            return 1
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Lock validation failed: {error}')
        return 1
    print('Python lock is complete and compatible with the manifest (no upgrades).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
