from __future__ import annotations

import argparse
import json
import shutil
import struct
from pathlib import Path

import numpy as np

KEEP = ("config.json", "generation_config.json", "chat_template.jinja", "processor_config.json", "tokenizer.json",
        "tokenizer_config.json")
META_NAMES = ("jevol_config.json", "playjev_train.json")
META_KEYS = ("questions", "options", "state_prefix", "action_profile", "readout")
CHUNK = 64 * 2 ** 20


def read_header(path: Path) -> tuple[dict, int]:
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        return json.loads(f.read(n)), 8 + n


def write_header(f, header: dict) -> None:
    body = json.dumps(header, separators=(",", ":")).encode()
    body += b" " * (-len(body) % 8)
    f.write(struct.pack("<Q", len(body)))
    f.write(body)


def copy_without(src: Path, dst: Path, drop_prefix: str) -> list[str]:
    header, start = read_header(src)
    meta = header.pop("__metadata__", None)
    kept = sorted((k for k in header if not k.startswith(drop_prefix)), key=lambda k: header[k]["data_offsets"][0])
    out, at = {}, 0
    for k in kept:
        a, b = header[k]["data_offsets"]
        out[k] = {**header[k], "data_offsets": [at, at + b - a]}
        at += b - a
    if meta is not None:
        out["__metadata__"] = meta
    with open(src, "rb") as fin, open(dst, "wb") as fout:
        write_header(fout, out)
        for k in kept:
            a, b = header[k]["data_offsets"]
            fin.seek(start + a)
            left = b - a
            while left:
                block = fin.read(min(CHUNK, left))
                fout.write(block)
                left -= len(block)
    return [k for k in header if k.startswith(drop_prefix)]


def to_float16(raw: bytes, dtype: str, shape: list[int]) -> np.ndarray:
    if dtype == "F16":
        x = np.frombuffer(raw, np.float16)
    elif dtype == "F32":
        x = np.frombuffer(raw, np.float32).astype(np.float16)
    elif dtype == "BF16":
        x = (np.frombuffer(raw, np.uint16).astype(np.uint32) << 16).view(np.float32).astype(np.float16)
    else:
        raise ValueError(f"unexpected head dtype {dtype}")
    return x.reshape(shape)


def head_to_float16(src: Path, dst: Path) -> None:
    header, start = read_header(src)
    meta = header.pop("__metadata__", None)
    arrays = {}
    with open(src, "rb") as f:
        for k, v in header.items():
            a, b = v["data_offsets"]
            f.seek(start + a)
            arrays[k] = to_float16(f.read(b - a), v["dtype"], v["shape"])
    out, at, order = {}, 0, sorted(arrays)
    for k in order:
        n = arrays[k].nbytes
        out[k] = {"dtype": "F16", "shape": list(arrays[k].shape), "data_offsets": [at, at + n]}
        at += n
    if meta is not None:
        out["__metadata__"] = meta
    with open(dst, "wb") as f:
        write_header(f, out)
        for k in order:
            f.write(np.ascontiguousarray(arrays[k]).tobytes())


def slim(src: Path, dst: Path) -> dict:
    if src.resolve() == dst.resolve():
        raise ValueError("the output directory must differ from the input directory")
    meta_path = next((src / n for n in META_NAMES if (src / n).exists()), None)
    if meta_path is None:
        raise FileNotFoundError(f"{src}: none of {', '.join(META_NAMES)}")
    dst.mkdir(parents=True, exist_ok=True)
    dropped = copy_without(src / "model.safetensors", dst / "model.safetensors", "lm_head.")
    head_to_float16(src / "sentence_head.safetensors", dst / "sentence_head.safetensors")
    for name in KEEP:
        if (src / name).exists():
            shutil.copy2(src / name, dst / name)
    meta = json.loads(meta_path.read_text())
    keep = {k: meta[k] for k in META_KEYS if k in meta}
    (dst / "jevol_config.json").write_text(json.dumps(keep, indent=1, ensure_ascii=False))
    size = sum(p.stat().st_size for p in dst.iterdir() if p.is_file())
    return {"out": str(dst), "dropped": dropped, "config": sorted(keep), "gb": round(size / 1e9, 3)}


def main():
    parser = argparse.ArgumentParser(description="Make a release checkpoint: no LM head, float16 sentence head, "
                                                 "reduced jevol_config.json.")
    parser.add_argument("src", type=Path, help="trained checkpoint directory")
    parser.add_argument("dst", type=Path, help="output directory")
    args = parser.parse_args()
    print(json.dumps(slim(args.src, args.dst)))


if __name__ == "__main__":
    main()
