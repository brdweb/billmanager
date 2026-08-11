import json
from pathlib import Path


ASSET_LINKS_PATH = (
    Path(__file__).resolve().parents[2]
    / "web"
    / "public"
    / ".well-known"
    / "assetlinks.json"
)


def test_android_asset_links_trusts_release_signing_certificate():
    statements = json.loads(ASSET_LINKS_PATH.read_text(encoding="utf-8"))

    assert statements == [
        {
            "relation": [
                "delegate_permission/common.handle_all_urls",
                "delegate_permission/common.get_login_creds",
            ],
            "target": {
                "namespace": "android_app",
                "package_name": "com.brdweb.billmanagermobile",
                "sha256_cert_fingerprints": [
                    "8E:15:2C:AB:4C:77:ED:B6:0A:0B:89:E4:B4:82:FD:67:"
                    "B1:B1:82:0A:94:E1:3D:DB:02:DD:C5:E5:8C:C5:E6:80"
                ],
            },
        }
    ]
