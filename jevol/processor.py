from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from tokenizers import Tokenizer

IMAGE_TOKEN = "<|image_pad|>"


def smart_resize(height: int, width: int, factor: int, min_pixels: int, max_pixels: int) -> tuple[int, int]:
    h = round(height / factor) * factor
    w = round(width / factor) * factor
    if h * w > max_pixels:
        beta = math.sqrt((height * width) / max_pixels)
        h = max(factor, math.floor(height / beta / factor) * factor)
        w = max(factor, math.floor(width / beta / factor) * factor)
    elif h * w < min_pixels:
        beta = math.sqrt(min_pixels / (height * width))
        h = math.ceil(height * beta / factor) * factor
        w = math.ceil(width * beta / factor) * factor
    return h, w


def cubic(x: np.ndarray, a: float = -0.5) -> np.ndarray:
    x = np.abs(x)
    near = ((a + 2) * x - (a + 3)) * x * x + 1
    far = (((x - 5) * x + 8) * x - 4) * a
    return np.where(x < 1, near, np.where(x < 2, far, 0.0))


def resize_axis(x: np.ndarray, size: int, axis: int) -> np.ndarray:
    length = x.shape[axis]
    scale = length / size
    support = 2.0 * max(scale, 1.0)
    inv = 1.0 / max(scale, 1.0)
    centers = scale * (np.arange(size) + 0.5)
    starts = np.maximum((centers - support + 0.5).astype(np.int64), 0)
    ends = np.minimum((centers + support + 0.5).astype(np.int64), length)
    taps = int((ends - starts).max())
    offsets = np.arange(taps)
    weights = cubic((offsets[None, :] - centers[:, None] + 0.5 + starts[:, None]) * inv)
    weights = np.where(offsets[None, :] < (ends - starts)[:, None], weights, 0.0)
    weights /= weights.sum(1, keepdims=True)
    precision = 0
    while precision < 15:
        if int(0.5 + weights.max() * (1 << (precision + 1))) >= 1 << 15:
            break
        precision += 1
    fixed = np.where(weights >= 0, np.floor(weights * (1 << precision) + 0.5), np.ceil(weights * (1 << precision) - 0.5)).astype(np.int64)
    index = np.minimum(starts[:, None] + offsets[None, :], length - 1)
    data = np.moveaxis(x, axis, 0).astype(np.int64)
    acc = np.full((size, *data.shape[1:]), 1 << (precision - 1), np.int64)
    for k in range(taps):
        acc += fixed[:, k].reshape(-1, *([1] * (data.ndim - 1))) * data[index[:, k]]
    out = np.clip(acc >> precision, 0, 255).astype(np.uint8)
    return np.moveaxis(out, 0, axis)


def bf16_round(x: np.ndarray) -> np.ndarray:
    bits = np.ascontiguousarray(x, dtype=np.float32).view(np.uint32)
    rounded = (bits + 0x7FFF + ((bits >> 16) & 1)) & 0xFFFF0000
    return rounded.astype(np.uint32).view(np.float32)


class Processor:
    def __init__(self, checkpoint: Path, config: dict):
        cfg = json.loads((checkpoint / "processor_config.json").read_text())["image_processor"]
        self.patch = cfg["patch_size"]
        self.merge = cfg["merge_size"]
        self.temporal = cfg["temporal_patch_size"]
        self.min_pixels = cfg["size"]["shortest_edge"]
        self.max_pixels = cfg["size"]["longest_edge"]
        self.mean = (np.array(cfg["image_mean"], np.float64) * (1 / cfg["rescale_factor"])).astype(np.float32)
        self.std = (np.array(cfg["image_std"], np.float64) * (1 / cfg["rescale_factor"])).astype(np.float32)
        self.tokenizer = Tokenizer.from_file(str(checkpoint / "tokenizer.json"))
        self.image_token_id = config["image_token_id"]
        text = config["text_config"]
        rope = text["rope_parameters"]
        rotary = int(text["head_dim"] * rope.get("partial_rotary_factor", 1.0))
        self.text_inv_freq = (1.0 / (np.float32(rope["rope_theta"]) ** (np.arange(0, rotary, 2, dtype=np.float32) / np.float32(rotary)))).astype(np.float32)
        self.mrope_section = rope.get("mrope_section", [11, 11, 10])
        vision = config["vision_config"]
        self.vision = vision
        spatial = (vision["hidden_size"] // vision["num_heads"]) // 2
        theta = np.float32(vision["rope_parameters"]["rope_theta"])
        self.vision_inv_freq = (1.0 / (theta ** (np.arange(0, spatial, 2, dtype=np.float32) / np.float32(spatial)))).astype(np.float32)

    def pixels(self, image: Image.Image) -> tuple[np.ndarray, tuple[int, int, int]]:
        factor = self.patch * self.merge
        h, w = smart_resize(image.height, image.width, factor, self.min_pixels, self.max_pixels)
        x = np.asarray(image.convert("RGB"), dtype=np.uint8)
        if x.shape[1] != w:
            x = resize_axis(x, w, 1)
        if x.shape[0] != h:
            x = resize_axis(x, h, 0)
        x = x.astype(np.float32).transpose(2, 0, 1)
        x = (x - self.mean[:, None, None]) / self.std[:, None, None]
        gh, gw, m, p = h // self.patch, w // self.patch, self.merge, self.patch
        x = x.reshape(3, gh // m, m, p, gw // m, m, p).transpose(1, 4, 2, 5, 0, 3, 6)
        x = np.broadcast_to(x[:, :, :, :, :, None], (*x.shape[:5], self.temporal, p, p))
        return np.ascontiguousarray(x.reshape(gh * gw, 3 * self.temporal * p * p)), (1, gh, gw)

    def tokens(self, prompt: str, grid: tuple[int, int, int]) -> np.ndarray:
        count = grid[0] * grid[1] * grid[2] // (self.merge * self.merge)
        text = prompt.replace(IMAGE_TOKEN, IMAGE_TOKEN * count)
        return np.array(self.tokenizer.encode(text).ids, np.int64)

    def positions(self, ids: np.ndarray, grid: tuple[int, int, int]) -> np.ndarray:
        image = ids == self.image_token_id
        out = np.zeros((3, len(ids)), np.int64)
        pos = 0
        i = 0
        while i < len(ids):
            j = i
            while j < len(ids) and image[j] == image[i]:
                j += 1
            if image[i]:
                t, h, w = grid[0], grid[1] // self.merge, grid[2] // self.merge
                tt, hh, ww = np.meshgrid(np.arange(t), np.arange(h) + pos, np.arange(w) + pos, indexing="ij")
                block = np.stack([tt, hh, ww]).reshape(3, -1)
                block[0] += pos
                out[:, i:j] = block
                pos += max(grid[1], grid[2]) // self.merge
            else:
                out[:, i:j] = np.arange(j - i) + pos
                pos += j - i
            i = j
        return out

    def text_rotary(self, positions: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        freqs = positions.astype(np.float32)[:, :, None] * self.text_inv_freq[None, None, :]
        cos, sin = np.cos(freqs), np.sin(freqs)

        def compose(f):
            out = f[0].copy()
            for dim, offset in ((1, 1), (2, 2)):
                idx = slice(offset, self.mrope_section[dim] * 3, 3)
                out[:, idx] = f[dim][:, idx]
            return bf16_round(np.concatenate([out, out], -1))

        return compose(cos), compose(sin)

    def vision_positions(self, grid: tuple[int, int, int]) -> np.ndarray:
        t, h, w = grid
        m = self.merge
        hh, ww = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
        hh = hh.reshape(h // m, m, w // m, m).transpose(0, 2, 1, 3).reshape(-1)
        ww = ww.reshape(h // m, m, w // m, m).transpose(0, 2, 1, 3).reshape(-1)
        return np.tile(np.stack([hh, ww], -1), (t, 1))

    def vision_rotary(self, grid: tuple[int, int, int]) -> tuple[np.ndarray, np.ndarray]:
        pos = self.vision_positions(grid).astype(np.float32)
        freqs = pos[:, :, None] * self.vision_inv_freq
        cos, sin = np.cos(freqs), np.sin(freqs)

        def compose(f):
            hw = np.concatenate([f[:, 0], f[:, 1]], -1)
            return np.concatenate([hw, hw], -1)

        return compose(cos), compose(sin)

    def interpolation(self, grid: tuple[int, int, int]) -> tuple[np.ndarray, np.ndarray]:
        side = int(self.vision["num_position_embeddings"] ** 0.5)
        t, h, w = grid
        m = self.merge
        within = np.arange(t * h * w) % (h * w)
        blocks_w = w // m
        in_col = within % m
        in_row = (within // m) % m
        block_col = (within // (m * m)) % blocks_w
        block_row = within // (m * m * blocks_w)

        def axis(index, size):
            src = index.astype(np.float32) * np.float32(side - 1) / np.float32(max(size - 1, 1))
            floor = np.floor(src)
            taps = np.clip(floor.astype(np.int64)[:, None] + np.arange(2), 0, side - 1)
            weights = np.clip(1 - np.abs(src[:, None] - floor[:, None] - np.arange(2, dtype=np.float32)), 0, None)
            return taps, weights.astype(np.float32)

        ht, hw_ = axis(block_row * m + in_row, h)
        wt, ww_ = axis(block_col * m + in_col, w)
        indices = (ht[:, :, None] * side + wt[:, None, :]).reshape(-1, 4)
        weights = (hw_[:, :, None] * ww_[:, None, :]).reshape(-1, 4)
        return indices, weights
