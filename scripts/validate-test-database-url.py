#!/usr/bin/env python3
"""Reject database URLs that do not identify the approved destructive test target."""

import os
import sys
from urllib.parse import parse_qs, unquote, urlsplit

APPROVED = {
    "host": "192.168.40.113",
    "port": 5432,
    "database": "bills_test",
    "user": "billsuser",
}
QUERY_TARGET_OVERRIDES = {"host", "port", "dbname", "database", "user", "service"}


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    try:
        parsed = urlsplit(url)
        query = {
            unquote(key).lower(): values
            for key, values in parse_qs(parsed.query, keep_blank_values=True).items()
        }
        hostaddr_values = query.get("hostaddr", [])
        matches = (
            parsed.scheme in {"postgres", "postgresql"}
            and parsed.hostname == APPROVED["host"]
            and parsed.port == APPROVED["port"]
            and unquote(parsed.path.lstrip("/")) == APPROVED["database"]
            and parsed.username is not None
            and unquote(parsed.username) == APPROVED["user"]
            and parsed.password not in (None, "")
            and QUERY_TARGET_OVERRIDES.isdisjoint(query)
            and all(value == APPROVED["host"] for value in hostaddr_values)
        )
    except (TypeError, ValueError):
        matches = False

    if not matches:
        print(
            "Refusing external database: target is not the approved test database",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
