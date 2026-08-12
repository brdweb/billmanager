import json
from pathlib import Path


ASSOCIATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "web"
    / "public"
    / ".well-known"
    / "apple-app-site-association"
)


def test_apple_app_site_association_trusts_billmanager_ios_app():
    association = json.loads(ASSOCIATION_PATH.read_text(encoding="utf-8"))
    app_id = "CLG4C84DNR.com.brdweb.billmanager"

    assert association["webcredentials"] == {"apps": [app_id]}
    assert association["applinks"]["details"] == [
        {
            "appIDs": [app_id],
            "components": [
                {
                    "/": "/auth/callback*",
                    "comment": (
                        "Return hosted OAuth callbacks to the BillManager iOS app."
                    ),
                }
            ],
        }
    ]


def test_apple_app_site_association_is_served_as_json(client):
    response = client.get("/.well-known/apple-app-site-association")

    assert response.status_code == 200
    assert response.mimetype == "application/json"
    assert response.get_json()["webcredentials"]["apps"] == [
        "CLG4C84DNR.com.brdweb.billmanager"
    ]
