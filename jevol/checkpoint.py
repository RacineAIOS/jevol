from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import actions
from .prompt import STATE_PREFIX

CONFIG_NAMES = ("jevol_config.json", "playjev_train.json")
REQUIRED_FILES = ("config.json", "model.safetensors", "sentence_head.safetensors", "processor_config.json",
                  "tokenizer.json")


def read_meta(checkpoint: Path) -> dict:
    for name in CONFIG_NAMES:
        path = checkpoint / name
        if path.exists():
            return json.loads(path.read_text())
    raise FileNotFoundError(f"{checkpoint}: none of {', '.join(CONFIG_NAMES)}")


def check(checkpoint: str | Path) -> tuple[Path, dict, tuple[str, ...]]:
    checkpoint = Path(checkpoint).expanduser()
    missing = [n for n in REQUIRED_FILES if not (checkpoint / n).exists()]
    if missing:
        raise FileNotFoundError(f"{checkpoint}: missing {', '.join(missing)}")
    meta = read_meta(checkpoint)
    if not meta.get("readout"):
        raise ValueError(f"{checkpoint} has no sentence head")
    options = meta.get("options", {})
    questions = tuple(q for q in ("move", "altitude", "side") if q in options)
    if questions[:2] != ("move", "altitude"):
        raise ValueError(f"{checkpoint}: the move and altitude questions are required")
    for q in questions:
        if [o["name"] for o in options[q]] != actions.OPTION_NAMES[q]:
            raise ValueError(f"{checkpoint}: the options of {q!r} differ from this decoder")
        if meta.get("questions", {}).get(q, actions.QUESTIONS[q]) != actions.QUESTIONS[q]:
            raise ValueError(f"{checkpoint}: the question {q!r} differs from this prompt")
    if meta.get("state_prefix", STATE_PREFIX) != STATE_PREFIX:
        raise ValueError(f"{checkpoint}: the state prefix differs from this prompt")
    return checkpoint, meta, questions


def option_table(head_config: dict, question: str) -> tuple[np.ndarray, np.ndarray]:
    where = {t: i for i, t in enumerate(head_config["vocab"])}
    ids = [[where[t] for t in o] for o in head_config["options"][question]]
    n = max(map(len, ids))
    tok = np.array([i + [0] * (n - len(i)) for i in ids], np.int64)
    mask = np.array([[1.0] * len(i) + [0.0] * (n - len(i)) for i in ids], np.float32)
    return tok, mask


def split_prompts(processor, questions, prompt_of, instruction: str, grid: tuple[int, int, int],
                  image_token: int) -> dict:
    ids, pos = [], []
    for q in questions:
        tokens = processor.tokens(prompt_of(q, instruction), grid)
        ids.append(tokens)
        pos.append(processor.positions(tokens, grid))
    n = min(map(len, ids))
    same = np.stack([i[:n] == ids[0][:n] for i in ids]).all(0)
    cut = n if bool(same.all()) else int(np.flatnonzero(~same)[0])
    cut = min(cut, n - 1)
    image_at = np.flatnonzero(ids[0] == image_token)
    if len(image_at) == 0 or int(image_at[-1]) >= cut or cut < 4:
        raise RuntimeError("the question prompts do not share the image")
    if any(not np.array_equal(p[:, :cut], pos[0][:, :cut]) for p in pos):
        raise RuntimeError("the shared prefix has different positions under two questions")
    a, b = int(image_at[0]), int(image_at[-1]) + 1
    if b - a != len(image_at):
        raise RuntimeError("the image tokens are not contiguous")
    slen = [len(i) - cut for i in ids]
    s = max(slen)
    sid = np.zeros((len(ids), s), np.int64)
    spos = np.zeros((3, len(ids), s), np.int64)
    for j, (i, p) in enumerate(zip(ids, pos)):
        sid[j, :slen[j]] = i[cut:]
        spos[:, j, :slen[j]] = p[:, cut:]
    return {"ids": ids[0], "pos": pos[0], "cut": cut, "a": a, "b": b, "slen": tuple(slen), "sid": sid, "spos": spos}
