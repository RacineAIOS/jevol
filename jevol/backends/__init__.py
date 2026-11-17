from __future__ import annotations

import importlib.util
import platform
import sys

BACKENDS = ("auto", "mlx", "cuda")


def _cuda_available() -> bool:
    if importlib.util.find_spec("torch") is None:
        return False
    import torch

    return torch.cuda.is_available()


def _apple_silicon() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


def resolve(name: str = "auto") -> str:
    if name not in BACKENDS:
        raise ValueError(f"unknown backend {name!r}, expected one of {', '.join(BACKENDS)}")
    if name != "auto":
        return name
    if _cuda_available():
        return "cuda"
    if _apple_silicon():
        if importlib.util.find_spec("mlx") is None:
            raise RuntimeError("this Mac has no MLX: install it with pip install -e \".[mlx]\"")
        return "mlx"
    raise RuntimeError("no backend found: use an NVIDIA GPU with PyTorch CUDA (pip install -e \".[cuda]\") or a Mac "
                       "with Apple silicon and MLX (pip install -e \".[mlx]\"); to test the CUDA code without a GPU, "
                       "pass --backend cuda --device cpu")


def create(name: str, checkpoint, questions, prompt_of, **options):
    if name == "mlx":
        from .mlx import MLXBackend

        return MLXBackend(checkpoint, questions, prompt_of, **options)
    if name == "cuda":
        from .cuda import CUDABackend

        return CUDABackend(checkpoint, questions, prompt_of, **options)
    raise ValueError(f"unknown backend {name!r}")
