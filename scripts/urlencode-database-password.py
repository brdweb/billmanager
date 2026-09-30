#!/usr/bin/env python3
"""Percent-encode a database password read from standard input."""

import sys
from urllib.parse import quote


sys.stdout.write(quote(sys.stdin.read(), safe=""))
