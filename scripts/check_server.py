from __future__ import annotations

import argparse
import asyncio
import io
import json
import time
from pathlib import Path

from PIL import Image

from jevol.server import pack_act


def jpeg(path: Path | None) -> bytes:
    image = Image.open(path).convert("RGB") if path else Image.new("RGB", (672, 504), (120, 140, 160))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90, subsampling=0)
    return buffer.getvalue()


async def run(args) -> None:
    import aiohttp

    image = jpeg(args.image)
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(args.url, max_msg_size=0) as ws:
            await ws.send_str(json.dumps({"type": "hello"}))
            print(json.dumps(await ws.receive_json()))
            for i in range(args.count):
                t0 = time.perf_counter()
                await ws.send_bytes(pack_act([{"id": 0, "mission": args.mission, "image": image}], ident=i))
                reply = await ws.receive_json()
                if reply.get("type") != "act":
                    raise SystemExit(json.dumps(reply))
                drone = reply["drones"][0]
                print(json.dumps({"id": reply["id"], "server_ms": reply["ms"],
                                  "round_trip_ms": round(1000 * (time.perf_counter() - t0), 1),
                                  **{k: drone[k] for k in ("forward", "yaw", "up", "right", "top")}}))


def main():
    parser = argparse.ArgumentParser(description="Send decisions to a running jevol server over its WebSocket.")
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws")
    parser.add_argument("--image", type=Path, default=None, help="camera image (default: a plain grey image)")
    parser.add_argument("--mission", default="Fly forward along the road.")
    parser.add_argument("--count", type=int, default=3)
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
