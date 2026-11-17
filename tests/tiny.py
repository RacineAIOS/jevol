from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from safetensors.numpy import save_file
from tokenizers import Tokenizer, models, pre_tokenizers

from jevol import actions
from jevol.policy import prompt_of

HIDDEN, VISION, MERGED = 64, 32, 128
SPECIAL = ["<|vision_start|>", "<|image_pad|>", "<|vision_end|>"]
MISSIONS = ["Fly forward along the road.", "Go to the red car and stop."]
LAYERS = ["linear_attention", "linear_attention", "linear_attention", "full_attention"]


def _tokenizer(path: Path) -> int:
    split = pre_tokenizers.Whitespace()
    words = {"[UNK]"}
    for mission in MISSIONS:
        for q in actions.QUESTIONS:
            words |= {w for w, _ in split.pre_tokenize_str(prompt_of(q, mission))}
    vocab = {w: i for i, w in enumerate(sorted(words))}
    tok = Tokenizer(models.WordLevel(vocab, unk_token="[UNK]"))
    tok.pre_tokenizer = split
    tok.add_special_tokens(SPECIAL)
    tok.save(str(path / "tokenizer.json"))
    return tok.token_to_id("<|image_pad|>"), tok.get_vocab_size()


def _config(image_token: int) -> dict:
    return {
        "image_token_id": image_token,
        "text_config": {
            "hidden_size": HIDDEN, "head_dim": 32, "num_attention_heads": 2, "num_key_value_heads": 1,
            "linear_num_key_heads": 2, "linear_num_value_heads": 4, "linear_key_head_dim": 32,
            "linear_value_head_dim": 16, "linear_conv_kernel_dim": 4, "intermediate_size": 128,
            "layer_types": LAYERS, "rms_norm_eps": 1e-6,
            "rope_parameters": {"rope_theta": 10000, "partial_rotary_factor": 0.25, "mrope_section": [2, 1, 1]},
        },
        "vision_config": {
            "hidden_size": VISION, "num_heads": 2, "depth": 1, "intermediate_size": 64, "num_position_embeddings": 16,
            "out_hidden_size": HIDDEN, "patch_size": 16, "spatial_merge_size": 2, "temporal_patch_size": 2,
            "rope_parameters": {"rope_theta": 10000.0},
        },
    }


def _weights(rng, vocab: int) -> dict:
    def r(*shape, scale=0.1):
        return (rng.standard_normal(shape) * scale).astype(np.float32)

    v, lm = "model.visual.", "model.language_model."
    w = {v + "patch_embed.proj.weight": r(VISION, 3, 2, 16, 16, scale=0.02), v + "patch_embed.proj.bias": r(VISION),
         v + "pos_embed.weight": r(16, VISION), v + "merger.norm.weight": 1 + r(VISION), v + "merger.norm.bias": r(VISION),
         v + "merger.linear_fc1.weight": r(MERGED, MERGED), v + "merger.linear_fc1.bias": r(MERGED),
         v + "merger.linear_fc2.weight": r(HIDDEN, MERGED), v + "merger.linear_fc2.bias": r(HIDDEN),
         lm + "embed_tokens.weight": r(vocab, HIDDEN, scale=0.5), lm + "norm.weight": r(HIDDEN),
         "lm_head.weight": r(vocab, HIDDEN)}
    b = v + "blocks.0."
    w.update({b + "norm1.weight": 1 + r(VISION), b + "norm1.bias": r(VISION), b + "norm2.weight": 1 + r(VISION),
              b + "norm2.bias": r(VISION), b + "attn.qkv.weight": r(3 * VISION, VISION),
              b + "attn.qkv.bias": r(3 * VISION), b + "attn.proj.weight": r(VISION, VISION),
              b + "attn.proj.bias": r(VISION), b + "mlp.linear_fc1.weight": r(64, VISION),
              b + "mlp.linear_fc1.bias": r(64), b + "mlp.linear_fc2.weight": r(VISION, 64),
              b + "mlp.linear_fc2.bias": r(VISION)})
    for i, kind in enumerate(LAYERS):
        p = f"{lm}layers.{i}."
        w.update({p + "input_layernorm.weight": r(HIDDEN), p + "post_attention_layernorm.weight": r(HIDDEN),
                  p + "mlp.gate_proj.weight": r(128, HIDDEN), p + "mlp.up_proj.weight": r(128, HIDDEN),
                  p + "mlp.down_proj.weight": r(HIDDEN, 128)})
        if kind == "linear_attention":
            a = p + "linear_attn."
            w.update({a + "in_proj_qkv.weight": r(192, HIDDEN), a + "in_proj_z.weight": r(64, HIDDEN),
                      a + "in_proj_b.weight": r(4, HIDDEN), a + "in_proj_a.weight": r(4, HIDDEN), a + "A_log": r(4),
                      a + "dt_bias": r(4), a + "conv1d.weight": r(192, 1, 4, scale=0.3), a + "norm.weight": 1 + r(16),
                      a + "out_proj.weight": r(HIDDEN, 64)})
        else:
            a = p + "self_attn."
            w.update({a + "q_proj.weight": r(128, HIDDEN), a + "k_proj.weight": r(32, HIDDEN),
                      a + "v_proj.weight": r(32, HIDDEN), a + "q_norm.weight": r(32), a + "k_norm.weight": r(32),
                      a + "o_proj.weight": r(HIDDEN, 64)})
    return w


def _head(rng) -> tuple[dict, dict]:
    dim, words = 16, list(range(100, 112))
    end = 999
    options = {}
    for q, names in actions.OPTION_NAMES.items():
        options[q] = [[words[(i * 3 + j) % len(words)] for j in range(1 + i % 3)] + [words[i % 5], end]
                      for i in range(len(names))]
    vocab = sorted({t for ids in options.values() for o in ids for t in o})
    config = {"hidden": HIDDEN, "vocab": vocab, "options": options, "dim": dim, "layers": 1, "heads": 2}

    def r(*shape, scale=0.2):
        return (rng.standard_normal(shape) * scale).astype(np.float32)

    h = {"rows": r(len(vocab), HIDDEN, scale=1.0), "query.weight": r(3, dim), "pos.weight": r(12, dim),
         "mem_in.0.weight": r(dim, HIDDEN), "mem_in.0.bias": r(dim), "mem_in.1.weight": 1 + r(dim),
         "mem_in.1.bias": r(dim), "tok_in.weight": r(dim, HIDDEN), "tok_in.bias": r(dim),
         "out.0.weight": 1 + r(dim), "out.0.bias": r(dim), "out.1.weight": r(HIDDEN, dim), "out.1.bias": r(HIDDEN),
         "log_scale": np.array(2.77, np.float32)}
    p = "blocks.0."
    for n in ("n1", "n2", "n3"):
        h[p + n + ".weight"], h[p + n + ".bias"] = 1 + r(dim), r(dim)
    for n in ("own", "state"):
        h.update({p + n + ".in_proj_weight": r(3 * dim, dim), p + n + ".in_proj_bias": r(3 * dim),
                  p + n + ".out_proj.weight": r(dim, dim), p + n + ".out_proj.bias": r(dim)})
    h.update({p + "mlp.0.weight": r(4 * dim, dim), p + "mlp.0.bias": r(4 * dim), p + "mlp.2.weight": r(dim, 4 * dim),
              p + "mlp.2.bias": r(dim)})
    return h, config


def make_checkpoint(path: Path, seed: int = 0, config_name: str = "jevol_config.json") -> Path:
    path.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    image_token, vocab = _tokenizer(path)
    (path / "config.json").write_text(json.dumps(_config(image_token)))
    (path / "processor_config.json").write_text(json.dumps({"image_processor": {
        "patch_size": 16, "merge_size": 2, "temporal_patch_size": 2, "image_mean": [0.5] * 3, "image_std": [0.5] * 3,
        "rescale_factor": 1 / 255, "size": {"shortest_edge": 4096, "longest_edge": 16384}}}))
    save_file(_weights(rng, vocab), str(path / "model.safetensors"))
    head, head_config = _head(rng)
    save_file(head, str(path / "sentence_head.safetensors"))
    meta = {"questions": dict(actions.QUESTIONS),
            "options": {q: [{"name": n, "description": ""} for n in names] for q, names in actions.OPTION_NAMES.items()},
            "state_prefix": "Mission: ", "readout": {"kind": "head", "config": head_config}}
    (path / config_name).write_text(json.dumps(meta))
    return path
