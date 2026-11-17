from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from .backends import BACKENDS

WEB_ROOT = Path(__file__).resolve().parent.parent / "web" / "dist"


def backend_options(args, parser) -> dict:
    if args.backend == "mlx":
        for flag, value in (("--device", args.device), ("--kernel", args.kernel != "auto"), ("--no-graphs", args.no_graphs)):
            if value:
                parser.error(f"{flag} applies to the cuda backend only")
        options = {"cache_gb": args.cache_gb}
    elif args.backend == "cuda":
        options = {"device": args.device, "kernel": args.kernel, "graphs": False if args.no_graphs else None}
    else:
        options = {}
    if args.dtype:
        options["dtype"] = args.dtype
    return options


def add_model_arguments(p: argparse.ArgumentParser) -> None:
    p.add_argument("--checkpoint", required=True, type=Path, help="checkpoint directory")
    p.add_argument("--backend", default="auto", choices=BACKENDS,
                   help="auto: cuda when PyTorch sees an NVIDIA GPU, else mlx on Apple silicon")
    p.add_argument("--device", default=None, help="cuda backend: cuda (default), cuda:1, or cpu / mps for tests")
    p.add_argument("--dtype", default=None, help="float16, bfloat16 or float32 (default: float16 on mlx, CUDA "
                                                 "and mps, float32 on cpu)")
    p.add_argument("--kernel", default="auto", choices=("auto", "fla", "torch"),
                   help="cuda backend: gated delta rule kernel (fla needs flash-linear-attention)")
    p.add_argument("--no-graphs", action="store_true", help="cuda backend: run eagerly, without CUDA graphs")
    p.add_argument("--cache-gb", type=float, default=1.0, help="mlx backend: buffer cache limit")


def resolved(args, parser) -> tuple[str, dict]:
    from . import backends

    try:
        args.backend = backends.resolve(args.backend)
    except (RuntimeError, ValueError) as e:
        parser.error(str(e))
    return args.backend, backend_options(args, parser)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="jevol", description="Jevol drone policy: inference server and tools.")
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("serve", help="serve the simulator page and the model over a WebSocket")
    add_model_arguments(s)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--web", type=Path, default=None, help="built page directory (default: web/dist when it exists)")
    s.add_argument("--no-web", action="store_true", help="serve the WebSocket only")
    a = sub.add_parser("act", help="one decision for an image and a mission")
    add_model_arguments(a)
    a.add_argument("--image", required=True, type=Path)
    a.add_argument("--mission", required=True)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    backend, options = resolved(args, parser)
    if args.command == "serve":
        from .server import serve

        root = None
        if not args.no_web:
            root = args.web or WEB_ROOT
            if not (root / "index.html").exists():
                if args.web is not None:
                    parser.error(f"no built page in {root}: run the web build first")
                root = None
        serve(args.checkpoint, backend, options, args.host, args.port, root.resolve() if root else None)
    else:
        from PIL import Image

        from .policy import Policy

        policy = Policy(args.checkpoint, backend, **options)
        result = policy.act([Image.open(args.image)], [args.mission])[0]
        print(json.dumps({"backend": policy.info(), **{k: v for k, v in result.items() if k != "probs"}}, indent=1))


if __name__ == "__main__":
    main()
