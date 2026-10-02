import json
from pathlib import Path

import app as server_app


ASSET_LINKS_PATH = (
    Path(__file__).resolve().parents[2]
    / "web"
    / "public"
    / ".well-known"
    / "assetlinks.json"
)


def test_android_asset_links_trusts_upload_and_play_signing_certificates():
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
                    "B1:B1:82:0A:94:E1:3D:DB:02:DD:C5:E5:8C:C5:E6:80",
                    "6D:91:46:56:05:53:7C:83:68:57:75:BE:F4:7A:11:C1:"
                    "7F:B6:40:96:C2:A4:52:8F:83:E0:20:AD:E6:43:75:38",
                ],
            },
        }
    ]


def test_association_routes_use_built_frontend_files(monkeypatch, tmp_path):
    dist_dir = tmp_path / "dist"
    well_known_dir = dist_dir / ".well-known"
    well_known_dir.mkdir(parents=True)
    asset_links = [{"source": "built-frontend"}]
    (well_known_dir / "assetlinks.json").write_text(
        json.dumps(asset_links), encoding="utf-8"
    )
    (well_known_dir / "apple-app-site-association").write_text(
        json.dumps({"source": "built-frontend"}), encoding="utf-8"
    )
    monkeypatch.setattr(server_app, "get_client_dir", lambda: str(dist_dir))

    with server_app.app.test_request_context():
        android_response = server_app.android_asset_links()
        ios_response = server_app.apple_app_site_association()
        android_response.direct_passthrough = False
        ios_response.direct_passthrough = False

    assert android_response.status_code == 200
    assert android_response.get_json() == asset_links
    assert ios_response.status_code == 200
    assert ios_response.get_json() == {"source": "built-frontend"}
