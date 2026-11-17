from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

from . import actions, backends
from .checkpoint import check
from .prompt import build_prompt

IMAGE_SIZE = (672, 504)
JPEG_QUALITY = 90


def prompt_of(question: str, mission: str) -> str:
    return build_prompt(actions.QUESTIONS[question], mission)


class Policy:
    def __init__(self, checkpoint: str | Path, backend: str = "auto", **options):
        checkpoint, _, self.questions = check(checkpoint)
        self.checkpoint = checkpoint
        self.backend = backends.resolve(backend)
        self.model = backends.create(self.backend, checkpoint, self.questions, prompt_of, **options)

    @staticmethod
    def prepare(image: Image.Image) -> Image.Image:
        image = image.convert("RGB")
        if image.size != IMAGE_SIZE:
            image = image.resize(IMAGE_SIZE, Image.BILINEAR)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=JPEG_QUALITY, subsampling=0)
        buffer.seek(0)
        return Image.open(buffer).convert("RGB")

    def probabilities(self, images, missions) -> dict:
        scores = self.model.scores([self.prepare(im) for im in images], list(missions))
        out = {}
        for q in self.questions:
            x = scores[q].astype(np.float32)
            x = np.exp(x - x.max(-1, keepdims=True))
            out[q] = x / x.sum(-1, keepdims=True)
        return out

    def act(self, images, missions) -> list[dict]:
        probs = self.probabilities(images, missions)
        results = []
        for i in range(len(images)):
            p = {q: probs[q][i] for q in self.questions}
            command = actions.decode(p["move"], p["altitude"], p.get("side"))
            top = {}
            for q in self.questions:
                j = int(p[q].argmax())
                top[q] = [actions.OPTION_NAMES[q][j], round(float(p[q][j]), 3)]
            results.append({**command, "top": top,
                            "probs": {q: [round(float(x), 5) for x in p[q]] for q in self.questions}})
        return results

    def info(self) -> dict:
        return {"backend": self.backend, "checkpoint": self.checkpoint.name, **self.model.info()}
