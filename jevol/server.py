from __future__ import annotations

import asyncio
import io
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from aiohttp import WSMsgType, web
from PIL import Image

MAX_DRONES = 4
MAX_IMAGE_BYTES = 2 * 2 ** 20
MAX_MISSION_CHARS = 400
WARM_MISSION = "Fly forward along the road."

log = logging.getLogger("jevol")


def parse_act(data: bytes) -> dict:
    if len(data) < 4:
        raise ValueError("message too short")
    n = int.from_bytes(data[:4], "little")
    if 4 + n > len(data):
        raise ValueError("header longer than the message")
    message = json.loads(data[4:4 + n].decode())
    at = 4 + n
    drones = message.get("drones")
    if not isinstance(drones, list) or not 1 <= len(drones) <= MAX_DRONES:
        raise ValueError(f"expected 1 to {MAX_DRONES} drones")
    for drone in drones:
        size = int(drone["bytes"])
        if not 0 < size <= MAX_IMAGE_BYTES:
            raise ValueError("missing or too large image")
        drone["image"] = bytes(data[at:at + size])
        at += size
        mission = drone.get("mission")
        if not isinstance(mission, str) or not 0 < len(mission) <= MAX_MISSION_CHARS:
            raise ValueError("missing or too long mission")
    if at != len(data):
        raise ValueError("image sizes do not match the message length")
    return message


def pack_act(drones: list[dict], ident=None) -> bytes:
    header = {"type": "act", "id": ident,
              "drones": [{"id": d.get("id"), "mission": d["mission"], "bytes": len(d["image"])} for d in drones]}
    body = json.dumps(header).encode()
    return len(body).to_bytes(4, "little") + body + b"".join(d["image"] for d in drones)


class Engine:
    def __init__(self, checkpoint: Path, backend: str, options: dict):
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.policy = None
        self.checkpoint, self.backend, self.options = checkpoint, backend, options

    def _load(self):
        from .policy import IMAGE_SIZE, Policy

        t0 = time.perf_counter()
        self.policy = Policy(self.checkpoint, self.backend, **self.options)
        self.policy.act([Image.new("RGB", IMAGE_SIZE)], [WARM_MISSION])
        log.info("model loaded in %.1f s: %s", time.perf_counter() - t0, json.dumps(self.policy.info()))

    async def load(self):
        await asyncio.get_running_loop().run_in_executor(self.executor, self._load)

    def _act(self, message: dict) -> dict:
        images = [Image.open(io.BytesIO(d["image"])) for d in message["drones"]]
        t0 = time.perf_counter()
        results = self.policy.act(images, [d["mission"] for d in message["drones"]])
        ms = 1000 * (time.perf_counter() - t0)
        drones = [{"id": d.get("id"), **r} for d, r in zip(message["drones"], results)]
        return {"type": "act", "id": message.get("id"), "ms": round(ms, 1), "drones": drones}

    async def act(self, message: dict) -> dict:
        return await asyncio.get_running_loop().run_in_executor(self.executor, self._act, message)

    def ready(self) -> dict:
        return {"type": "ready", "questions": list(self.policy.questions), **self.policy.info()}


async def socket(request: web.Request) -> web.WebSocketResponse:
    engine: Engine = request.app["engine"]
    ws = web.WebSocketResponse(max_msg_size=MAX_IMAGE_BYTES * MAX_DRONES + 65536)
    await ws.prepare(request)
    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            try:
                message = json.loads(msg.data)
            except ValueError:
                await ws.send_json({"type": "error", "id": None, "message": "invalid JSON"})
                continue
            if isinstance(message, dict) and message.get("type") == "hello":
                await ws.send_json(engine.ready())
            continue
        if msg.type != WSMsgType.BINARY:
            continue
        ident = None
        try:
            message = parse_act(msg.data)
            ident = message.get("id")
            await ws.send_json(await engine.act(message))
        except Exception as e:
            log.exception("decision failed")
            await ws.send_json({"type": "error", "id": ident, "message": f"{type(e).__name__}: {e}"})
    return ws


async def info(request: web.Request) -> web.Response:
    return web.json_response(request.app["engine"].ready())


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(request.app["root"] / "index.html")


def create_app(engine: Engine, root: Path | None) -> web.Application:
    app = web.Application()
    app["engine"] = engine
    app["root"] = root
    app.router.add_get("/ws", socket)
    app.router.add_get("/info", info)
    if root is not None:
        app.router.add_get("/", index)
        app.router.add_static("/", root)
    return app


def serve(checkpoint: Path, backend: str, options: dict, host: str, port: int, root: Path | None) -> None:
    engine = Engine(checkpoint, backend, options)

    async def start(app):
        await engine.load()
        if root is None:
            log.info("no built page: WebSocket only at ws://%s:%d/ws", host, port)
        else:
            log.info("open http://%s:%d", host, port)

    app = create_app(engine, root)
    app.on_startup.append(start)
    web.run_app(app, host=host, port=port, print=None)
