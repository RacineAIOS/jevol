from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

QUESTIONS = ("move", "altitude", "side")


def read_manifest(path: Path, limit: int) -> list[dict]:
    entries = json.loads(path.read_text())
    out = []
    for e in entries[:limit or None]:
        image = Path(e["image"])
        out.append({"image": image if image.is_absolute() else path.parent / image, "mission": e["mission"]})
    return out


def dump(args) -> None:
    from jevol import Policy

    options = {k: v for k, v in (("device", args.device), ("dtype", args.dtype)) if v}
    if args.backend == "cuda" and args.no_graphs:
        options["graphs"] = False
    policy = Policy(args.checkpoint, args.backend, **options)
    entries = read_manifest(args.manifest, args.limit)
    probs = {q: [] for q in policy.questions}
    times = []
    for e in entries:
        t0 = time.perf_counter()
        p = policy.probabilities([Image.open(e["image"])], [e["mission"]])
        times.append(time.perf_counter() - t0)
        for q in policy.questions:
            probs[q].append(p[q][0])
    np.savez(args.out, **{q: np.stack(v) for q, v in probs.items()},
             missions=np.array([e["mission"] for e in entries]))
    steady = times[1:] or times
    print(json.dumps({"backend": policy.info(), "images": len(entries), "out": str(args.out),
                      "ms_first": round(1000 * times[0], 1), "ms_median": round(1000 * float(np.median(steady)), 1)}))


def compare(args) -> None:
    from jevol import actions

    a, b = np.load(args.a), np.load(args.b)
    if list(a["missions"]) != list(b["missions"]):
        raise SystemExit("the two files do not hold the same missions")
    report = {"images": int(len(a["missions"]))}
    for q in QUESTIONS:
        if q not in a.files or q not in b.files:
            continue
        diff = np.abs(a[q] - b[q])
        report[q] = {"max_abs_diff": float(diff.max()), "mean_abs_diff": float(diff.mean()),
                     "argmax_agreement": float((a[q].argmax(-1) == b[q].argmax(-1)).mean())}
    same = 0
    for i in range(len(a["missions"])):
        ca = actions.decode(a["move"][i], a["altitude"][i], a["side"][i] if "side" in a.files else None)
        cb = actions.decode(b["move"][i], b["altitude"][i], b["side"][i] if "side" in b.files else None)
        same += all(abs(ca[k] - cb[k]) < 1e-6 for k in ca)
    report["same_command"] = same / len(a["missions"])
    print(json.dumps(report, indent=1))


def main():
    parser = argparse.ArgumentParser(description="Compare the option probabilities of two Jevol backends.")
    sub = parser.add_subparsers(dest="command", required=True)
    d = sub.add_parser("dump", help="write the probabilities of one backend for a list of images")
    d.add_argument("--checkpoint", required=True, type=Path)
    d.add_argument("--backend", default="auto", choices=("auto", "mlx", "cuda"))
    d.add_argument("--device", default=None)
    d.add_argument("--dtype", default=None)
    d.add_argument("--no-graphs", action="store_true")
    d.add_argument("--manifest", required=True, type=Path, help="JSON list of {\"image\": path, \"mission\": text}")
    d.add_argument("--limit", type=int, default=0)
    d.add_argument("--out", required=True, type=Path)
    c = sub.add_parser("compare", help="compare two files written by dump")
    c.add_argument("a", type=Path)
    c.add_argument("b", type=Path)
    args = parser.parse_args()
    dump(args) if args.command == "dump" else compare(args)


if __name__ == "__main__":
    main()
