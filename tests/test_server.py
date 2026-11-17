import json

import pytest

pytest.importorskip("aiohttp")

from jevol.server import MAX_DRONES, pack_act, parse_act


def test_round_trip():
    drones = [{"id": 1, "mission": "Go to the car.", "image": b"\xff\xd8abc"},
              {"id": 2, "mission": "Land.", "image": b"\xff\xd8defgh"}]
    message = parse_act(pack_act(drones, ident=7))
    assert message["id"] == 7
    assert [d["image"] for d in message["drones"]] == [d["image"] for d in drones]
    assert [d["mission"] for d in message["drones"]] == ["Go to the car.", "Land."]


@pytest.mark.parametrize("change", ["extra", "missing", "mission", "drones"])
def test_rejects_bad_messages(change):
    drones = [{"id": 1, "mission": "Go.", "image": b"abcd"}]
    data = pack_act(drones)
    if change == "extra":
        data += b"x"
    elif change == "missing":
        data = data[:-1]
    elif change == "mission":
        data = pack_act([{**drones[0], "mission": "x" * 401}])
    else:
        data = pack_act(drones * (MAX_DRONES + 1))
    with pytest.raises(ValueError):
        parse_act(data)


def test_header_is_json():
    data = pack_act([{"id": 1, "mission": "Go.", "image": b"abcd"}])
    n = int.from_bytes(data[:4], "little")
    assert json.loads(data[4:4 + n])["drones"][0]["bytes"] == 4
