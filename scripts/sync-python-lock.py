#!/usr/bin/env python3
"""Name the direct requirements a Dependabot edit may upgrade in the lock.

Compare two copies of apps/server/requirements.txt. Print one normalized
package name per line for a requirement that was added or whose spec
changed. Removals are not printed: recompiling against the existing lock
drops them without --upgrade-package, and a blanket --upgrade would float
unrelated pins. Exit 2 when the direct requirements are unchanged.
"""
import argparse
import re
import sys


def normalize_name(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def _strip_ws_outside_quotes(text):
    stripped = []
    quote = None
    for character in text:
        if quote:
            stripped.append(character)
            if character == quote:
                quote = None
            continue
        if character in ('"', "'"):
            quote = character
            stripped.append(character)
            continue
        if character.isspace():
            continue
        stripped.append(character)
    if quote:
        raise ValueError('unterminated quote in requirement')
    return ''.join(stripped)


def _canonical_spec(rest):
    rest = rest.strip()
    extras = ''
    if rest.startswith('['):
        end = rest.find(']')
        if end < 0:
            raise ValueError('unclosed extras')
        names = [
            normalize_name(part.strip())
            for part in rest[1:end].split(',')
            if part.strip()
        ]
        if not names:
            raise ValueError('empty extras')
        extras = '[' + ','.join(sorted(names)) + ']'
        rest = rest[end + 1:]
    if '@' in rest:
        raise ValueError('direct URL requirements are not supported')
    spec = _strip_ws_outside_quotes(rest)
    if spec.startswith(('-', '/', '.')):
        raise ValueError(f'unsupported requirement syntax: {spec}')
    return extras + spec


def direct_requirements(text, label):
    """Map a normalized project name to its canonical extras and specifier."""
    found = {}
    for number, line in enumerate(text.splitlines(), 1):
        code = line.split('#', 1)[0].strip()
        if not code:
            continue
        if code.startswith(('-', 'git+', 'http://', 'https://', 'file:')):
            raise ValueError(f'{label}:{number}: unsupported requirement: {code}')
        match = re.fullmatch(r'([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(.*)', code)
        if not match:
            raise ValueError(f'{label}:{number}: expected a package requirement: {code}')
        name = normalize_name(match[1])
        try:
            spec = _canonical_spec(match[2])
        except ValueError as error:
            raise ValueError(f'{label}:{number}: {error}') from error
        if name in found:
            raise ValueError(f'{label}:{number}: duplicate requirement: {name}')
        found[name] = spec
    return found


def upgrade_packages(base_text, head_text, label_base='base', label_head='head'):
    """Packages added or edited in head. Removals are omitted on purpose."""
    base = direct_requirements(base_text, label_base)
    head = direct_requirements(head_text, label_head)
    if base == head:
        return None
    return sorted(name for name, spec in head.items() if base.get(name) != spec)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='requirements.txt at the pull request merge base')
    parser.add_argument('--head', required=True, help='requirements.txt on the pull request branch')
    args = parser.parse_args()
    try:
        with open(args.base, encoding='utf-8') as base_file:
            base_text = base_file.read()
        with open(args.head, encoding='utf-8') as head_file:
            head_text = head_file.read()
        packages = upgrade_packages(base_text, head_text, label_base=args.base, label_head=args.head)
    except (OSError, ValueError) as error:
        print(f'Could not compare requirements: {error}', file=sys.stderr)
        return 1
    if packages is None:
        return 2
    for name in packages:
        print(name)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
