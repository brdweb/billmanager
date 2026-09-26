"""Optional product analytics must work under the real production CSP."""
import importlib

import pytest

from services.product_analytics import analytics_sources


@pytest.mark.parametrize("script_url,expected", [
    ("", []),
    ("  ", []),
    ("https://metrics.example.test/script.js", ["https://metrics.example.test"]),
    ("https://metrics.example.test:8443/custom/script.js", ["https://metrics.example.test:8443"]),
])
def test_analytics_sources(script_url, expected):
    assert analytics_sources(script_url) == expected


@pytest.mark.parametrize("script_url", [
    "http://metrics.example.test/script.js",
    "//metrics.example.test/script.js",
    "javascript:alert(1)",
    "https://user:password@metrics.example.test/script.js",
    "https://metrics.example.test/script.js?secret=value",
    "https://metrics.example.test/script.js#fragment",
    "https://metrics.example.test/;script-src *",
    "https://*.example.test/script.js",
    "https://metrics.example.test:99999/script.js",
    "https://metrics.example.test\\@other.test/script.js",
])
def test_analytics_sources_reject_unsafe_configuration(script_url):
    with pytest.raises(ValueError, match="UMAMI_SCRIPT_URL"):
        analytics_sources(script_url)


@pytest.mark.parametrize("script_url,extra", [
    ("", []),
    ("https://metrics.example.test:8443/custom/script.js", ["https://metrics.example.test:8443"]),
])
def test_production_csp_permits_only_configured_origin(monkeypatch, script_url, extra):
    app_module = importlib.import_module("app")
    monkeypatch.setattr(app_module, "_is_production_security_mode", lambda: True)
    monkeypatch.setenv("UMAMI_SCRIPT_URL", script_url)
    application = app_module.create_app()
    response = application.test_client().get("/api/health", base_url="https://bills.example.test")
    directives = dict(
        (parts[0], parts[1:])
        for directive in response.headers["Content-Security-Policy"].split(";")
        if (parts := directive.split())
    )
    assert directives["script-src"] == ["'self'", *extra]
    assert directives["connect-src"] == ["'self'", *extra]
    assert directives["default-src"] == ["'self'"]
    assert directives["object-src"] == ["'none'"]
