"""Explicit, narrowly scoped CSP access for the optional web analytics build."""

import re
from urllib.parse import urlsplit


def analytics_sources(script_url):
    """Return only a validated HTTPS origin; never interpolate raw input into CSP."""
    script_url = script_url.strip()
    if not script_url:
        return []
    try:
        url = urlsplit(script_url)
        valid = (
            url.scheme == "https"
            and url.hostname
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and not re.search(r"[\s\"'<>\\;*]", script_url)
        )
        # Accessing port also validates malformed/out-of-range port values.
        url.port
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("UMAMI_SCRIPT_URL must be an absolute HTTPS URL without credentials, query, fragment, or unsafe characters")
    return [f"https://{url.netloc}"]
