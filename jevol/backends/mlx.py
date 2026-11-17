from __future__ import annotations

import json
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import numpy as np
from mlx_lm.models.gated_delta import gated_delta_kernel, gated_delta_ops

from ..checkpoint import option_table, read_meta, split_prompts
from ..processor import Processor

LM = "model.language_model."
VIS = "model.visual."


class MLXBackend:
    name = "mlx"

    def __init__(self, checkpoint: str | Path, questions, prompt_of, dtype: str = "float16", cache_gb: float = 1.0):
        mx.set_cache_limit(int(cache_gb * 2 ** 30))
        checkpoint = Path(checkpoint)
        self.checkpoint, self.questions, self.prompt_of = checkpoint, tuple(questions), prompt_of
        self.dt = getattr(mx, dtype)
        self.device = "gpu" if mx.metal.is_available() else "cpu"
        self.config = json.loads((checkpoint / "config.json").read_text())
        self.tc, self.vc = self.config["text_config"], self.config["vision_config"]
        if any(t not in ("linear_attention", "full_attention") for t in self.tc["layer_types"]):
            raise ValueError(f"unknown layer types: {set(self.tc['layer_types'])}")
        self.processor = Processor(checkpoint, self.config)
        self.image_token = self.config["image_token_id"]
        self._load(checkpoint)
        self._load_head(checkpoint)
        self._tokens: dict = {}
        self._pre: dict = {}
        self._grids: dict = {}
        self._fns: dict = {}

    def _load(self, checkpoint: Path) -> None:
        raw = mx.load(str(checkpoint / "model.safetensors"))
        raw.pop("lm_head.weight", None)
        self.pos_table = np.array(raw[VIS + "pos_embed.weight"].astype(mx.float32))
        w = {}
        for k, v in raw.items():
            if k.endswith("conv1d.weight"):
                v = v[:, 0, :].T
            elif k.endswith("patch_embed.proj.weight"):
                v = v.reshape(v.shape[0], -1).T
            elif v.ndim == 2 and not k.endswith(("embed_tokens.weight", "pos_embed.weight")):
                v = v.T
            w[k] = v.astype(self.dt)
        mx.eval(w)
        self.w = w
        self.c32 = {}
        for i, t in enumerate(self.tc["layer_types"]):
            p = f"{LM}layers.{i}."
            for n in ("input_layernorm", "post_attention_layernorm"):
                self.c32[p + n] = 1.0 + raw[p + n + ".weight"].astype(mx.float32)
            if t == "linear_attention":
                self.c32[p + "A"] = -mx.exp(raw[p + "linear_attn.A_log"].astype(mx.float32))
            else:
                for n in ("q_norm", "k_norm"):
                    self.c32[p + n] = 1.0 + raw[p + f"self_attn.{n}.weight"].astype(mx.float32)
        self.c32["norm"] = 1.0 + raw[LM + "norm.weight"].astype(mx.float32)
        mx.eval(self.c32)
        del raw

    def _load_head(self, checkpoint: Path) -> None:
        cfg = read_meta(checkpoint)["readout"]["config"]
        h = {k: v.astype(mx.float32) for k, v in mx.load(str(checkpoint / "sentence_head.safetensors")).items()}
        self.hcfg = cfg
        rows = h["rows"]
        rows = rows / mx.maximum(mx.sqrt((rows * rows).sum(-1, keepdims=True)), 1e-12)
        qi = {q: i for i, q in enumerate(cfg["options"])}
        self.head_const = {}
        for q in self.questions:
            tok, mask = option_table(cfg, q)
            k, n = tok.shape
            start = mx.broadcast_to(h["query.weight"][qi[q]], (k, 1, cfg["dim"]))
            x0 = mx.concatenate([start, rows[mx.array(tok[:, :-1])] @ h["tok_in.weight"].T + h["tok_in.bias"]], 1) \
                + h["pos.weight"][:n]
            causal = mx.array(np.triu(np.full((n, n), -np.inf, np.float32), 1))
            self.head_const[q] = {"x0": x0, "tok": mx.array(tok), "mask": mx.array(mask), "causal": causal}
        self.h = h
        self.h["rows_n_t"] = rows.T
        self.h["scale"] = mx.exp(h["log_scale"])
        mx.eval(self.h, self.head_const)

    def _rotary(self, positions: np.ndarray):
        cos, sin = self.processor.text_rotary(positions)
        return mx.array(cos[None]).astype(self.dt), mx.array(sin[None]).astype(self.dt)

    def _entry(self, instruction: str, grid: tuple[int, int, int]) -> dict:
        key = (instruction, grid)
        if key not in self._tokens:
            sp = split_prompts(self.processor, self.questions, self.prompt_of, instruction, grid, self.image_token)
            ids0, pos0, cut, a, b, slen = sp["ids"], sp["pos"], sp["cut"], sp["a"], sp["b"], list(sp["slen"])
            sid, spos = sp["sid"], sp["spos"]
            emb = self.w[LM + "embed_tokens.weight"]
            pcos, psin = self._rotary(pos0[:, :cut])
            scs = [self._rotary(spos[:, j]) for j in range(len(slen))]
            pre_key = (ids0[:a].tobytes(), pos0[:, :a].tobytes())
            if pre_key not in self._pre:
                pre = emb[mx.array(ids0[:a])][None]
                if a > 0:
                    (h_pre,), c_pre = self._layers([pre], [(pcos[:, :a], psin[:, :a])], None)
                else:
                    h_pre, c_pre = pre, None
                mx.eval(h_pre, c_pre)
                if len(self._pre) > 8:
                    self._pre.clear()
                self._pre[pre_key] = (h_pre, c_pre)
            h_pre, c_pre = self._pre[pre_key]
            e = {"cut": cut, "a": a, "b": b, "slen": tuple(slen),
                 "h_pre": h_pre, "c_pre": c_pre, "post": emb[mx.array(ids0[b:cut])][None],
                 "cos1": pcos[:, a:], "sin1": psin[:, a:], "suffix": emb[mx.array(sid)],
                 "scos": mx.concatenate([c for c, _ in scs]), "ssin": mx.concatenate([s_ for _, s_ in scs])}
            mx.eval([v for k, v in e.items() if k not in ("cut", "a", "b", "slen")])
            if len(self._tokens) > 1024:
                self._tokens.clear()
            self._tokens[key] = e
        return self._tokens[key]

    def _grid(self, grid: tuple[int, int, int]) -> dict:
        if grid not in self._grids:
            idx, wt = self.processor.interpolation(grid)
            taps = self.pos_table[idx] * wt[:, :, None]
            pos = taps[:, 0]
            for k in range(1, taps.shape[1]):
                pos = pos + taps[:, k]
            cos, sin = self.processor.vision_rotary(grid)
            g = {"pos": mx.array(pos).astype(self.dt), "cos": mx.array(cos)[:, None, :], "sin": mx.array(sin)[:, None, :]}
            mx.eval(g)
            self._grids[grid] = g
        return self._grids[grid]

    def _layer_norm(self, x, p: str, eps: float = 1e-6):
        return mx.fast.layer_norm(x.astype(mx.float32), self.w[p + ".weight"].astype(mx.float32),
                                  self.w[p + ".bias"].astype(mx.float32), eps).astype(x.dtype)

    def _linear(self, x, p: str):
        b = self.w.get(p + ".bias")
        return x @ self.w[p + ".weight"] if b is None else mx.addmm(b, x, self.w[p + ".weight"])

    @staticmethod
    def _rotate_half(x):
        h = x.shape[-1] // 2
        return mx.concatenate([-x[..., h:], x[..., :h]], -1)

    def _vision(self, pixels, g: dict):
        vc = self.vc
        heads = vc["num_heads"]
        x = self._linear(pixels.astype(self.dt), VIS + "patch_embed.proj") + g["pos"]
        length = x.shape[0]
        scale = (vc["hidden_size"] // heads) ** -0.5
        for i in range(vc["depth"]):
            p = f"{VIS}blocks.{i}."
            qkv = self._linear(self._layer_norm(x, p + "norm1"), p + "attn.qkv").reshape(length, 3, heads, -1)
            qk = qkv[:, :2].astype(mx.float32)
            qk = (qk * g["cos"][:, None] + self._rotate_half(qk) * g["sin"][:, None]).astype(x.dtype)
            q, k, v = qk[:, 0].swapaxes(0, 1), qk[:, 1].swapaxes(0, 1), qkv[:, 2].swapaxes(0, 1)
            o = mx.fast.scaled_dot_product_attention(q[None], k[None], v[None], scale=scale)[0]
            x = x + self._linear(o.swapaxes(0, 1).reshape(length, -1), p + "attn.proj")
            h = self._linear(self._layer_norm(x, p + "norm2"), p + "mlp.linear_fc1")
            x = x + self._linear(self._gelu_tanh(h), p + "mlp.linear_fc2")
        unit = vc["spatial_merge_size"] ** 2
        x = self._layer_norm(x, VIS + "merger.norm").reshape(length // unit, -1)
        x = self._linear(nn.gelu(self._linear(x, VIS + "merger.linear_fc1")), VIS + "merger.linear_fc2")
        return x[None]

    @staticmethod
    def _gelu_tanh(x):
        return 0.5 * x * (1.0 + mx.tanh(0.7978845608028654 * (x + 0.044715 * (x * x * x))))

    @staticmethod
    def _rows(xs):
        flat = [x.reshape(-1, *x.shape[2:]) for x in xs]
        return (flat[0] if len(flat) == 1 else mx.concatenate(flat, 0)), [x.shape[:2] for x in xs]

    @staticmethod
    def _segments(flat, shapes):
        out, at = [], 0
        for b, t in shapes:
            out.append(flat[at:at + b * t].reshape(b, t, *flat.shape[1:]))
            at += b * t
        return out

    @staticmethod
    def _rep(x, b: int):
        return x if x.shape[0] == b else mx.repeat(x, b // x.shape[0], 0)

    @staticmethod
    def _rms(x, w1, eps: float = 1e-6):
        y = x.astype(mx.float32)
        y = y * mx.rsqrt((y * y).mean(-1, keepdims=True) + eps)
        return (y * w1).astype(x.dtype)

    def _linear_layer(self, i: int, h, shapes, cache):
        tc = self.tc
        p = f"{LM}layers.{i}.linear_attn."
        hk, hv = tc["linear_num_key_heads"], tc["linear_num_value_heads"]
        dk, dv = tc["linear_key_head_dim"], tc["linear_value_head_dim"]
        mixed = self._linear(h, p + "in_proj_qkv")
        z = self._linear(h, p + "in_proj_z").reshape(-1, hv, dv)
        beta = mx.sigmoid(self._linear(h, p + "in_proj_b")).astype(mx.float32)
        a = self._linear(h, p + "in_proj_a").astype(mx.float32) + self.w[p + "dt_bias"].astype(mx.float32)
        g = mx.exp(self.c32[f"{LM}layers.{i}.A"] * nn.softplus(a))
        wc = self.w[p + "conv1d.weight"]
        kk = wc.shape[0]
        metal = dk % 32 == 0 and mx.metal.is_available() and mx.default_device() == mx.gpu
        outs = []
        for m, be, gs in zip(*(self._segments(v, shapes) for v in (mixed, beta, g))):
            b, t = m.shape[:2]
            tail = mx.zeros((b, kk - 1, m.shape[-1]), m.dtype) if cache is None else self._rep(cache["conv"], b)
            padded = mx.concatenate([tail, m], 1)
            conv = padded[:, 0:t] * wc[0]
            for j in range(1, kk):
                conv = conv + padded[:, j:j + t] * wc[j]
            q, k, v = mx.split(nn.silu(conv), [hk * dk, 2 * hk * dk], -1)
            q, k = q.reshape(b, t, hk, dk).astype(mx.float32), k.reshape(b, t, hk, dk).astype(mx.float32)
            v = v.reshape(b, t, hv, dv).astype(mx.float32)
            q = q * mx.rsqrt((q * q).sum(-1, keepdims=True) + 1e-6) * (dk ** -0.5)
            k = k * mx.rsqrt((k * k).sum(-1, keepdims=True) + 1e-6)
            state = mx.zeros((b, hv, dv, dk), mx.float32) if cache is None else self._rep(cache["state"], b)
            if metal:
                out, state = gated_delta_kernel(q, k, v, gs, be, state)
            else:
                out, state = gated_delta_ops(q, k, v, gs, be, state)
            cache = {"conv": padded[:, -(kk - 1):], "state": state}
            outs.append(out.reshape(b * t, hv, dv))
        out = outs[0] if len(outs) == 1 else mx.concatenate(outs, 0)
        out = out.astype(self.dt).astype(mx.float32)
        out = (out * mx.rsqrt((out * out).mean(-1, keepdims=True) + tc["rms_norm_eps"])).astype(self.dt)
        out = (self.w[p + "norm.weight"] * out).astype(mx.float32) * nn.silu(z.astype(mx.float32))
        return self._linear(out.astype(self.dt).reshape(out.shape[0], -1), p + "out_proj"), cache

    def _attention_layer(self, i: int, h, cos, sin, shapes, cache):
        tc = self.tc
        p = f"{LM}layers.{i}.self_attn."
        n = h.shape[0]
        d, nh, nkv = tc["head_dim"], tc["num_attention_heads"], tc["num_key_value_heads"]
        qg = self._linear(h, p + "q_proj").reshape(n, nh, 2 * d)
        q, gate = qg[..., :d], qg[..., d:].reshape(n, -1)
        q = self._rms(q, self.c32[f"{LM}layers.{i}.q_norm"])
        k = self._rms(self._linear(h, p + "k_proj").reshape(n, nkv, d), self.c32[f"{LM}layers.{i}.k_norm"])
        v = self._linear(h, p + "v_proj").reshape(n, nkv, d)
        r = cos.shape[-1]
        q = mx.concatenate([q[..., :r] * cos + self._rotate_half(q[..., :r]) * sin, q[..., r:]], -1)
        k = mx.concatenate([k[..., :r] * cos + self._rotate_half(k[..., :r]) * sin, k[..., r:]], -1)
        rep = nh // nkv
        outs = []
        for qs, ks, vs in zip(*(self._segments(x, shapes) for x in (q, k, v))):
            b, t = qs.shape[:2]
            ks, vs = ks.swapaxes(1, 2), vs.swapaxes(1, 2)
            mask = mx.triu(mx.full((t, t), -float("inf"), mx.float32), 1)
            if cache is not None:
                pc = cache["k"].shape[2]
                ks = mx.concatenate([mx.broadcast_to(cache["k"], (b, *cache["k"].shape[1:])), ks], 2)
                vs = mx.concatenate([mx.broadcast_to(cache["v"], (b, *cache["v"].shape[1:])), vs], 2)
                mask = mx.concatenate([mx.zeros((t, pc), mx.float32), mask], 1)
            cache = {"k": ks, "v": vs}
            qq = qs.swapaxes(1, 2).reshape(b, nkv, rep, t, d)
            att = (qq * (d ** -0.5)) @ ks[:, :, None].swapaxes(-1, -2)
            att = mx.softmax(att.astype(mx.float32) + mask, axis=-1).astype(qs.dtype)
            o = (att @ vs[:, :, None]).reshape(b, nh, t, d)
            outs.append(o.swapaxes(1, 2).reshape(b * t, -1))
        o = (outs[0] if len(outs) == 1 else mx.concatenate(outs, 0)) * mx.sigmoid(gate)
        return self._linear(o, p + "o_proj"), cache

    def _layers(self, xs, rots, caches):
        x, shapes = self._rows(xs)
        cos, sin = self._rows([c for c, _ in rots])[0][:, None], self._rows([s for _, s in rots])[0][:, None]
        new = []
        for i, t in enumerate(self.tc["layer_types"]):
            p = f"{LM}layers.{i}."
            h = self._rms(x, self.c32[p + "input_layernorm"])
            cache = None if caches is None else caches[i]
            if t == "linear_attention":
                h, c = self._linear_layer(i, h, shapes, cache)
            else:
                h, c = self._attention_layer(i, h, cos, sin, shapes, cache)
            new.append(c)
            x = x + h
            h = self._rms(x, self.c32[p + "post_attention_layernorm"])
            x = x + self._linear(nn.silu(self._linear(h, p + "mlp.gate_proj")) * self._linear(h, p + "mlp.up_proj"),
                                 p + "mlp.down_proj")
        return self._segments(self._rms(x, self.c32["norm"]), shapes), new

    def _mha(self, p: str, q, k, mask=None):
        heads = self.hcfg["heads"]
        dim = q.shape[-1]
        wi, bi = self.h[p + ".in_proj_weight"], self.h[p + ".in_proj_bias"]

        def split(x):
            return x.reshape(x.shape[0], x.shape[1], heads, -1).swapaxes(1, 2)

        qq = split(q @ wi[:dim].T + bi[:dim])
        kk = split(k @ wi[dim:2 * dim].T + bi[dim:2 * dim])
        vv = split(k @ wi[2 * dim:].T + bi[2 * dim:])
        att = (qq * ((dim // heads) ** -0.5)) @ kk.swapaxes(-1, -2)
        if mask is not None:
            att = att + mask
        o = (mx.softmax(att, axis=-1) @ vv).swapaxes(1, 2).reshape(q.shape[0], q.shape[1], dim)
        return o @ self.h[p + ".out_proj.weight"].T + self.h[p + ".out_proj.bias"]

    def _head(self, states, question: str):
        h, c = self.h, self.head_const[question]

        def ln(x, p):
            return mx.fast.layer_norm(x, h[p + ".weight"], h[p + ".bias"], 1e-5)

        mem = ln(states.astype(mx.float32) @ h["mem_in.0.weight"].T + h["mem_in.0.bias"], "mem_in.1")
        x = c["x0"]
        k, n, d = x.shape
        for i in range(self.hcfg["layers"]):
            p = f"blocks.{i}."
            y = ln(x, p + "n1")
            x = x + self._mha(p + "own", y, y, c["causal"])
            y = ln(x, p + "n2").reshape(1, k * n, d)
            x = x + self._mha(p + "state", y, mem).reshape(k, n, d)
            y = ln(x, p + "n3")
            x = x + nn.gelu(y @ h[p + "mlp.0.weight"].T + h[p + "mlp.0.bias"]) @ h[p + "mlp.2.weight"].T \
                + h[p + "mlp.2.bias"]
        y = ln(x, "out.0") @ h["out.1.weight"].T + h["out.1.bias"]
        y = y / mx.maximum(mx.sqrt((y * y).sum(-1, keepdims=True)), 1e-12)
        logp = nn.log_softmax(y @ h["rows_n_t"] * h["scale"], -1)
        return (mx.take_along_axis(logp, c["tok"][..., None], -1)[..., 0] * c["mask"]).sum(-1)

    def _heads(self, h_prefix, h_suffix, slen):
        return [self._head(mx.concatenate([h_prefix, h_suffix[j:j + 1, :slen[j]]], 1), q)
                for j, q in enumerate(self.questions)]

    def _fn(self, key, build):
        if key not in self._fns:
            if len(self._fns) > 256:
                self._fns.clear()
            self._fns[key] = mx.compile(build)
        return self._fns[key]

    def scores(self, images, instructions) -> dict:
        prepared = [self.processor.pixels(im) for im in images]
        grids = {grid for _, grid in prepared}
        if len(grids) != 1:
            raise ValueError(f"the images of one call must have one size, grids {sorted(grids)}")
        grid = grids.pop()
        g = self._grid(grid)
        rows = []
        for (pixels, _), instruction in zip(prepared, instructions):
            e = self._entry(instruction, grid)
            key = (grid, e["cut"], e["a"], e["b"], e["slen"])
            slen = e["slen"]
            args = (e["h_pre"], e["c_pre"], e["post"], e["cos1"], e["sin1"], e["suffix"], e["scos"], e["ssin"])

            def whole(px, h_pre, c_pre, post, cos1, sin1, suffix, scos, ssin, g=g, slen=slen):
                x1 = mx.concatenate([self._vision(px, g).astype(self.dt), post], 1)
                (h1, hs), _ = self._layers([x1, suffix], [(cos1, sin1), (scos, ssin)], c_pre)
                return self._heads(mx.concatenate([h_pre, h1], 1), hs, slen)

            out = self._fn(key, whole)(mx.array(pixels), *args)
            mx.eval(out)
            rows.append([np.array(o) for o in out])
        return {q: np.stack([r[j] for r in rows]) for j, q in enumerate(self.questions)}

    def info(self) -> dict:
        return {"device": self.device, "dtype": str(self.dt).replace("mlx.core.", "")}
