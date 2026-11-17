from __future__ import annotations

import json
import logging
from collections import OrderedDict
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file

from ..checkpoint import option_table, read_meta, split_prompts
from ..processor import Processor

LM = "model.language_model."
VIS = "model.visual."
CHUNK = 64
KERNEL_TOLERANCE = 1e-2
DEFAULT_DTYPES = {"cuda": torch.float16, "mps": torch.float16, "cpu": torch.float32}

log = logging.getLogger("jevol")


def _rotate_half(x):
    h = x.shape[-1] // 2
    return torch.cat([-x[..., h:], x[..., :h]], -1)


def _solve(system, rhs, solve_device):
    if solve_device is not None and solve_device != rhs.device:
        return torch.linalg.solve_triangular(system.to(solve_device), rhs.to(solve_device), upper=False,
                                             unitriangular=True).to(rhs.device)
    return torch.linalg.solve_triangular(system, rhs, upper=False, unitriangular=True)


def delta_block(q, k, v, log_g, beta, state, solve_device=None):
    c = log_g.cumsum(-1)
    t = c.shape[-1]
    upper = torch.ones(t, t, dtype=torch.bool, device=q.device).triu(1)
    decay = (c[..., :, None] - c[..., None, :]).masked_fill(upper, float("-inf")).exp()
    kb, vb = k * beta[..., None], v * beta[..., None]
    kt = k.transpose(-1, -2)
    system = (kb @ kt) * decay
    attn = (q @ kt) * decay
    ec = c.exp()[..., None]
    rhs = vb if state is None else torch.cat([vb, kb * ec], -1)
    x = _solve(system, rhs, solve_device)
    k_end = (k * (c[..., -1:] - c).exp()[..., None]).transpose(-1, -2)
    if state is None:
        return attn @ x, k_end @ x
    d = v.shape[-1]
    v_new = x[..., :d] - x[..., d:] @ state
    out = (q * ec) @ state + attn @ v_new
    return out, state * c[..., -1].exp()[..., None, None] + k_end @ v_new


def gated_delta(q, k, v, log_g, beta, state=None, solve_device=None, chunk: int = CHUNK):
    q, k, v = (x.transpose(1, 2).float() for x in (q, k, v))
    log_g, beta = log_g.transpose(1, 2).float(), beta.transpose(1, 2).float()
    state = None if state is None else state.float()
    outs = []
    for s in range(0, q.shape[2], chunk):
        e = s + chunk
        o, state = delta_block(q[:, :, s:e], k[:, :, s:e], v[:, :, s:e], log_g[:, :, s:e], beta[:, :, s:e], state,
                               solve_device)
        outs.append(o)
    return torch.cat(outs, 2).transpose(1, 2), state


def gated_delta_reference(q, k, v, log_g, beta, state=None):
    b, t, h, dk = q.shape
    dv = v.shape[-1]
    s = torch.zeros(b, h, dk, dv, dtype=torch.float32, device=q.device) if state is None else state.float()
    out = []
    for i in range(t):
        s = s * log_g[:, i].float().exp()[..., None, None]
        kv = torch.einsum("bhkv,bhk->bhv", s, k[:, i].float())
        delta = (v[:, i].float() - kv) * beta[:, i].float()[..., None]
        s = s + k[:, i].float()[..., :, None] * delta[..., None, :]
        out.append(torch.einsum("bhkv,bhk->bhv", s, q[:, i].float()))
    return torch.stack(out, 1), s


class CUDABackend:
    name = "cuda"

    def __init__(self, checkpoint: str | Path, questions, prompt_of, device: str | None = None,
                 dtype: str | None = None, graphs: bool | None = None, kernel: str = "auto", max_graphs: int = 24):
        self.device = torch.device(device or "cuda")
        if self.device.type == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("no CUDA device: PyTorch does not see an NVIDIA GPU")
        if self.device.type == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("no MPS device")
        self.dt = DEFAULT_DTYPES[self.device.type] if dtype is None else getattr(torch, dtype)
        on_cuda = self.device.type == "cuda"
        self.graphs = on_cuda if graphs is None else bool(graphs) and on_cuda
        self.max_graphs = max_graphs
        self.solve_device = torch.device("cpu") if self.device.type == "mps" else None
        checkpoint = Path(checkpoint)
        self.checkpoint, self.questions, self.prompt_of = checkpoint, tuple(questions), prompt_of
        self.config = json.loads((checkpoint / "config.json").read_text())
        self.tc, self.vc = self.config["text_config"], self.config["vision_config"]
        if any(t not in ("linear_attention", "full_attention") for t in self.tc["layer_types"]):
            raise ValueError(f"unknown layer types: {set(self.tc['layer_types'])}")
        self.processor = Processor(checkpoint, self.config)
        self.image_token = self.config["image_token_id"]
        with torch.inference_mode():
            self._load(checkpoint)
            self._load_head(checkpoint)
        self._fla = None
        self.kernel = self._pick_kernel(kernel)
        self._tokens: dict = {}
        self._pre: dict = {}
        self._grids: dict = {}
        self._plans: OrderedDict = OrderedDict()
        self.recorded = 0
        self.notes: dict = {}

    def _load(self, checkpoint: Path) -> None:
        raw = load_file(str(checkpoint / "model.safetensors"))
        raw.pop("lm_head.weight", None)
        self.pos_table = raw[VIS + "pos_embed.weight"].float().numpy()
        w = {}
        for k, v in raw.items():
            if k.endswith("conv1d.weight"):
                v = v[:, 0, :].T
            elif k.endswith("patch_embed.proj.weight"):
                v = v.reshape(v.shape[0], -1)
            w[k] = v.to(self.device, self.dt).contiguous()
        self.w = w
        self.c32 = {}
        for i, t in enumerate(self.tc["layer_types"]):
            p = f"{LM}layers.{i}."
            for n in ("input_layernorm", "post_attention_layernorm"):
                self.c32[p + n] = 1.0 + raw[p + n + ".weight"].float().to(self.device)
            if t == "linear_attention":
                self.c32[p + "A"] = -raw[p + "linear_attn.A_log"].float().exp().to(self.device)
            else:
                for n in ("q_norm", "k_norm"):
                    self.c32[p + n] = 1.0 + raw[p + f"self_attn.{n}.weight"].float().to(self.device)
        self.c32["norm"] = 1.0 + raw[LM + "norm.weight"].float().to(self.device)
        del raw

    def _load_head(self, checkpoint: Path) -> None:
        cfg = read_meta(checkpoint)["readout"]["config"]
        h = {k: v.float().to(self.device) for k, v in load_file(str(checkpoint / "sentence_head.safetensors")).items()}
        self.hcfg = cfg
        rows = F.normalize(h["rows"], dim=-1)
        qi = {q: i for i, q in enumerate(cfg["options"])}
        self.head_const = {}
        for q in self.questions:
            tok, mask = option_table(cfg, q)
            k, n = tok.shape
            tok = torch.from_numpy(tok).to(self.device)
            start = h["query.weight"][qi[q]].expand(k, 1, cfg["dim"])
            x0 = torch.cat([start, F.linear(rows[tok[:, :-1]], h["tok_in.weight"], h["tok_in.bias"])], 1) \
                + h["pos.weight"][:n]
            causal = torch.full((n, n), float("-inf"), device=self.device).triu(1)
            self.head_const[q] = {"x0": x0, "tok": tok, "mask": torch.from_numpy(mask).to(self.device),
                                  "causal": causal}
        self.h = h
        self.h["rows_n_t"] = rows.T.contiguous()
        self.h["scale"] = h["log_scale"].exp()

    def _pick_kernel(self, kernel: str) -> str:
        if kernel not in ("auto", "fla", "torch"):
            raise ValueError(f"unknown kernel {kernel!r}")
        if kernel == "torch":
            return "torch"
        if self.device.type != "cuda":
            if kernel == "fla":
                raise ValueError("the fla kernel needs a CUDA device")
            return "torch"
        try:
            from fla.ops.gated_delta_rule import chunk_gated_delta_rule
        except ImportError:
            if kernel == "fla":
                raise
            log.info("flash-linear-attention is not installed: torch gated delta rule")
            return "torch"
        self._fla = chunk_gated_delta_rule
        try:
            error = self._check_fla()
        except Exception as e:
            error, reason = float("inf"), f"{type(e).__name__}: {e}"
        else:
            reason = f"relative error {error:.2e}"
        if error > KERNEL_TOLERANCE:
            self._fla = None
            if kernel == "fla":
                raise RuntimeError(f"the fla kernel does not match the torch reference ({reason})")
            log.warning("fla kernel rejected (%s): torch gated delta rule", reason)
            return "torch"
        log.info("fla kernel checked (%s)", reason)
        return "fla"

    def _check_fla(self) -> float:
        g = torch.Generator(device=self.device).manual_seed(0)
        b, t, h, dk, dv = 1, 200, self.tc["linear_num_value_heads"], self.tc["linear_key_head_dim"], \
            self.tc["linear_value_head_dim"]

        def rand(*shape):
            return torch.randn(*shape, generator=g, device=self.device)

        q, k = F.normalize(rand(b, t, h, dk), dim=-1) * dk ** -0.5, F.normalize(rand(b, t, h, dk), dim=-1)
        v = rand(b, t, h, dv)
        log_g = -torch.rand(b, t, h, generator=g, device=self.device) * 0.5
        beta = torch.rand(b, t, h, generator=g, device=self.device)
        state = rand(b, h, dk, dv) * 0.1
        worst = 0.0
        for s0 in (None, state):
            ref_out, ref_state = gated_delta(q, k, v, log_g, beta, s0)
            out, st = self._delta(q, k, v, log_g, beta, s0)
            for x, y in ((out, ref_out), (st, ref_state)):
                worst = max(worst, float((x.float() - y).abs().max() / (y.abs().max() + 1e-6)))
        return worst

    def _delta(self, q, k, v, log_g, beta, state):
        if self._fla is not None:
            out, state = self._fla(q, k, v, g=log_g, beta=beta, scale=1.0, initial_state=state,
                                   output_final_state=True)
            return out.float(), state.float()
        return gated_delta(q, k, v, log_g, beta, state, self.solve_device)

    def _tensor(self, x: np.ndarray, dtype=None):
        return torch.from_numpy(np.ascontiguousarray(x)).to(self.device, dtype or self.dt)

    def _rotary(self, positions: np.ndarray):
        cos, sin = self.processor.text_rotary(positions)
        return self._tensor(cos[None]), self._tensor(sin[None])

    def _entry(self, instruction: str, grid: tuple[int, int, int]) -> dict:
        key = (instruction, grid)
        if key not in self._tokens:
            sp = split_prompts(self.processor, self.questions, self.prompt_of, instruction, grid, self.image_token)
            ids0, pos0, cut, a, b, slen = sp["ids"], sp["pos"], sp["cut"], sp["a"], sp["b"], sp["slen"]
            emb = self.w[LM + "embed_tokens.weight"]
            pcos, psin = self._rotary(pos0[:, :cut])
            scs = [self._rotary(sp["spos"][:, j]) for j in range(len(slen))]
            pre_key = (ids0[:a].tobytes(), pos0[:, :a].tobytes())
            if pre_key not in self._pre:
                pre = emb[torch.from_numpy(ids0[:a]).to(self.device)][None]
                if a > 0:
                    (h_pre,), c_pre = self._layers([pre], [(pcos[:, :a], psin[:, :a])], None)
                else:
                    h_pre, c_pre = pre, None
                if len(self._pre) > 8:
                    self._pre.clear()
                self._pre[pre_key] = (h_pre, c_pre)
            h_pre, c_pre = self._pre[pre_key]
            inputs = {"h_pre": h_pre, "post": emb[torch.from_numpy(ids0[b:cut]).to(self.device)][None],
                      "cos1": pcos[:, a:], "sin1": psin[:, a:],
                      "suffix": emb[torch.from_numpy(sp["sid"]).to(self.device)],
                      "scos": torch.cat([c for c, _ in scs]), "ssin": torch.cat([s for _, s in scs])}
            for i, c in enumerate(c_pre or []):
                for name, value in c.items():
                    inputs[f"cache.{i}.{name}"] = value
            if len(self._tokens) > 1024:
                self._tokens.clear()
            self._tokens[key] = {"cut": cut, "a": a, "b": b, "slen": slen, "cached": c_pre is not None,
                                 "inputs": inputs}
        return self._tokens[key]

    def _grid(self, grid: tuple[int, int, int]) -> dict:
        if grid not in self._grids:
            idx, wt = self.processor.interpolation(grid)
            taps = self.pos_table[idx] * wt[:, :, None]
            pos = taps[:, 0]
            for k in range(1, taps.shape[1]):
                pos = pos + taps[:, k]
            cos, sin = self.processor.vision_rotary(grid)
            self._grids[grid] = {"pos": self._tensor(pos), "cos": self._tensor(cos, torch.float32)[:, None, :],
                                 "sin": self._tensor(sin, torch.float32)[:, None, :]}
        return self._grids[grid]

    def _layer_norm(self, x, p: str, eps: float = 1e-6):
        return F.layer_norm(x.float(), (x.shape[-1],), self.w[p + ".weight"].float(), self.w[p + ".bias"].float(),
                            eps).to(x.dtype)

    def _linear(self, x, p: str):
        return F.linear(x, self.w[p + ".weight"], self.w.get(p + ".bias"))

    def _vision(self, pixels, g: dict):
        vc = self.vc
        heads = vc["num_heads"]
        x = self._linear(pixels.to(self.dt), VIS + "patch_embed.proj") + g["pos"]
        length = x.shape[0]
        scale = (vc["hidden_size"] // heads) ** -0.5
        for i in range(vc["depth"]):
            p = f"{VIS}blocks.{i}."
            qkv = self._linear(self._layer_norm(x, p + "norm1"), p + "attn.qkv").reshape(length, 3, heads, -1)
            qk = qkv[:, :2].float()
            qk = (qk * g["cos"][:, None] + _rotate_half(qk) * g["sin"][:, None]).to(x.dtype)
            q, k, v = qk[:, 0].transpose(0, 1), qk[:, 1].transpose(0, 1), qkv[:, 2].transpose(0, 1)
            o = F.scaled_dot_product_attention(q[None], k[None], v[None], scale=scale)[0]
            x = x + self._linear(o.transpose(0, 1).reshape(length, -1), p + "attn.proj")
            h = self._linear(self._layer_norm(x, p + "norm2"), p + "mlp.linear_fc1")
            x = x + self._linear(F.gelu(h, approximate="tanh"), p + "mlp.linear_fc2")
        unit = vc["spatial_merge_size"] ** 2
        x = self._layer_norm(x, VIS + "merger.norm").reshape(length // unit, -1)
        x = self._linear(F.gelu(self._linear(x, VIS + "merger.linear_fc1")), VIS + "merger.linear_fc2")
        return x[None]

    @staticmethod
    def _rows(xs):
        flat = [x.reshape(-1, *x.shape[2:]) for x in xs]
        return (flat[0] if len(flat) == 1 else torch.cat(flat, 0)), [tuple(x.shape[:2]) for x in xs]

    @staticmethod
    def _segments(flat, shapes):
        out, at = [], 0
        for b, t in shapes:
            out.append(flat[at:at + b * t].reshape(b, t, *flat.shape[1:]))
            at += b * t
        return out

    @staticmethod
    def _rep(x, b: int):
        return x if x.shape[0] == b else x.repeat_interleave(b // x.shape[0], 0)

    @staticmethod
    def _rms(x, w1, eps: float = 1e-6):
        y = x.float()
        y = y * torch.rsqrt((y * y).mean(-1, keepdim=True) + eps)
        return (y * w1).to(x.dtype)

    def _linear_layer(self, i: int, h, shapes, cache):
        tc = self.tc
        p = f"{LM}layers.{i}.linear_attn."
        hk, hv = tc["linear_num_key_heads"], tc["linear_num_value_heads"]
        dk, dv = tc["linear_key_head_dim"], tc["linear_value_head_dim"]
        mixed = self._linear(h, p + "in_proj_qkv")
        z = self._linear(h, p + "in_proj_z").reshape(-1, hv, dv)
        beta = torch.sigmoid(self._linear(h, p + "in_proj_b")).float()
        a = self._linear(h, p + "in_proj_a").float() + self.w[p + "dt_bias"].float()
        log_g = self.c32[f"{LM}layers.{i}.A"] * F.softplus(a)
        wc = self.w[p + "conv1d.weight"]
        kk = wc.shape[0]
        outs = []
        for m, be, lg in zip(*(self._segments(v, shapes) for v in (mixed, beta, log_g))):
            b, t = m.shape[:2]
            if cache is None:
                tail = torch.zeros(b, kk - 1, m.shape[-1], dtype=m.dtype, device=m.device)
            else:
                tail = self._rep(cache["conv"], b)
            padded = torch.cat([tail, m], 1)
            conv = padded[:, 0:t] * wc[0]
            for j in range(1, kk):
                conv = conv + padded[:, j:j + t] * wc[j]
            q, k, v = torch.split(F.silu(conv), [hk * dk, hk * dk, hv * dv], -1)
            q, k = q.reshape(b, t, hk, dk).float(), k.reshape(b, t, hk, dk).float()
            v = v.reshape(b, t, hv, dv).float()
            q = q * torch.rsqrt((q * q).sum(-1, keepdim=True) + 1e-6) * (dk ** -0.5)
            k = k * torch.rsqrt((k * k).sum(-1, keepdim=True) + 1e-6)
            if hv != hk:
                q, k = q.repeat_interleave(hv // hk, 2), k.repeat_interleave(hv // hk, 2)
            state = None if cache is None else self._rep(cache["state"], b)
            out, state = self._delta(q, k, v, lg, be, state)
            cache = {"conv": padded[:, -(kk - 1):], "state": state}
            outs.append(out.reshape(b * t, hv, dv))
        out = outs[0] if len(outs) == 1 else torch.cat(outs, 0)
        out = out.to(self.dt).float()
        out = (out * torch.rsqrt((out * out).mean(-1, keepdim=True) + tc["rms_norm_eps"])).to(self.dt)
        out = (self.w[p + "norm.weight"] * out).float() * F.silu(z.float())
        return self._linear(out.to(self.dt).reshape(out.shape[0], -1), p + "out_proj"), cache

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
        q = torch.cat([q[..., :r] * cos + _rotate_half(q[..., :r]) * sin, q[..., r:]], -1)
        k = torch.cat([k[..., :r] * cos + _rotate_half(k[..., :r]) * sin, k[..., r:]], -1)
        rep = nh // nkv
        outs = []
        for qs, ks, vs in zip(*(self._segments(x, shapes) for x in (q, k, v))):
            b, t = qs.shape[:2]
            ks, vs = ks.transpose(1, 2), vs.transpose(1, 2)
            mask = torch.full((t, t), float("-inf"), device=h.device).triu(1)
            if cache is not None:
                pc = cache["k"].shape[2]
                ks = torch.cat([cache["k"].expand(b, *cache["k"].shape[1:]), ks], 2)
                vs = torch.cat([cache["v"].expand(b, *cache["v"].shape[1:]), vs], 2)
                mask = torch.cat([torch.zeros(t, pc, device=h.device), mask], 1)
            cache = {"k": ks, "v": vs}
            qq = qs.transpose(1, 2).reshape(b, nkv, rep, t, d)
            att = (qq * (d ** -0.5)) @ ks[:, :, None].transpose(-1, -2)
            att = torch.softmax(att.float() + mask, -1).to(qs.dtype)
            o = (att @ vs[:, :, None]).reshape(b, nh, t, d)
            outs.append(o.transpose(1, 2).reshape(b * t, -1))
        o = (outs[0] if len(outs) == 1 else torch.cat(outs, 0)) * torch.sigmoid(gate)
        return self._linear(o, p + "o_proj"), cache

    def _layers(self, xs, rots, caches):
        x, shapes = self._rows(xs)
        cos = self._rows([c for c, _ in rots])[0][:, None]
        sin = self._rows([s for _, s in rots])[0][:, None]
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
            x = x + self._linear(F.silu(self._linear(h, p + "mlp.gate_proj")) * self._linear(h, p + "mlp.up_proj"),
                                 p + "mlp.down_proj")
        return self._segments(self._rms(x, self.c32["norm"]), shapes), new

    def _mha(self, p: str, q, k, mask=None):
        heads = self.hcfg["heads"]
        dim = q.shape[-1]
        wi, bi = self.h[p + ".in_proj_weight"], self.h[p + ".in_proj_bias"]

        def split(x):
            return x.reshape(x.shape[0], x.shape[1], heads, -1).transpose(1, 2)

        qq = split(F.linear(q, wi[:dim], bi[:dim]))
        kk = split(F.linear(k, wi[dim:2 * dim], bi[dim:2 * dim]))
        vv = split(F.linear(k, wi[2 * dim:], bi[2 * dim:]))
        att = (qq * ((dim // heads) ** -0.5)) @ kk.transpose(-1, -2)
        if mask is not None:
            att = att + mask
        o = (torch.softmax(att, -1) @ vv).transpose(1, 2).reshape(q.shape[0], q.shape[1], dim)
        return F.linear(o, self.h[p + ".out_proj.weight"], self.h[p + ".out_proj.bias"])

    def _head(self, states, question: str):
        h, c = self.h, self.head_const[question]

        def ln(x, p):
            return F.layer_norm(x, (x.shape[-1],), h[p + ".weight"], h[p + ".bias"], 1e-5)

        mem = ln(F.linear(states.float(), h["mem_in.0.weight"], h["mem_in.0.bias"]), "mem_in.1")
        x = c["x0"]
        k, n, d = x.shape
        for i in range(self.hcfg["layers"]):
            p = f"blocks.{i}."
            y = ln(x, p + "n1")
            x = x + self._mha(p + "own", y, y, c["causal"])
            y = ln(x, p + "n2").reshape(1, k * n, d)
            x = x + self._mha(p + "state", y, mem).reshape(k, n, d)
            y = ln(x, p + "n3")
            x = x + F.linear(F.gelu(F.linear(y, h[p + "mlp.0.weight"], h[p + "mlp.0.bias"])), h[p + "mlp.2.weight"],
                             h[p + "mlp.2.bias"])
        y = F.linear(ln(x, "out.0"), h["out.1.weight"], h["out.1.bias"])
        y = y / torch.clamp(y.norm(dim=-1, keepdim=True), min=1e-12)
        logp = torch.log_softmax(y @ h["rows_n_t"] * h["scale"], -1)
        return (logp.gather(-1, c["tok"][..., None])[..., 0] * c["mask"]).sum(-1)

    def _forward(self, inputs: dict, g: dict, slen, cached: bool) -> tuple:
        caches = None
        if cached:
            caches = []
            for i, t in enumerate(self.tc["layer_types"]):
                names = ("conv", "state") if t == "linear_attention" else ("k", "v")
                caches.append({n: inputs[f"cache.{i}.{n}"] for n in names})
        x1 = torch.cat([self._vision(inputs["px"], g).to(self.dt), inputs["post"]], 1)
        (h1, hs), _ = self._layers([x1, inputs["suffix"]], [(inputs["cos1"], inputs["sin1"]),
                                                             (inputs["scos"], inputs["ssin"])], caches)
        h_prefix = torch.cat([inputs["h_pre"], h1], 1)
        return tuple(self._head(torch.cat([h_prefix, hs[j:j + 1, :slen[j]]], 1), q)
                     for j, q in enumerate(self.questions))

    def _plan(self, key, inputs: dict, g: dict, slen, cached: bool):
        if key in self._plans:
            self._plans.move_to_end(key)
            return self._plans[key]
        while len(self._plans) >= self.max_graphs:
            self._plans.popitem(last=False)
        static = {k: v.clone() for k, v in inputs.items()}
        stream = torch.cuda.Stream(self.device)
        stream.wait_stream(torch.cuda.current_stream(self.device))
        with torch.cuda.stream(stream):
            for _ in range(2):
                self._forward(static, g, slen, cached)
        torch.cuda.current_stream(self.device).wait_stream(stream)
        torch.cuda.synchronize(self.device)
        graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(graph):
            out = self._forward(static, g, slen, cached)
        self._plans[key] = (graph, static, out)
        self.recorded += 1
        return self._plans[key]

    def _run(self, px: torch.Tensor, e: dict, g: dict, grid) -> tuple:
        inputs = {"px": px, **e["inputs"]}
        if self.graphs:
            key = (grid, e["cut"], e["a"], e["b"], e["slen"])
            try:
                graph, static, out = self._plan(key, inputs, g, e["slen"], e["cached"])
            except Exception as err:
                self.graphs = False
                self._plans.clear()
                self.notes["graphs"] = f"{type(err).__name__}: {err}"[:300]
                log.warning("CUDA graph capture failed, running eagerly: %s", self.notes["graphs"])
            else:
                for k, v in inputs.items():
                    static[k].copy_(v)
                graph.replay()
                return tuple(o.clone() for o in out)
        return self._forward(inputs, g, e["slen"], e["cached"])

    @torch.inference_mode()
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
            px = torch.from_numpy(pixels).to(self.device, torch.float32)
            out = self._run(px, e, g, grid)
            rows.append([o.float().cpu().numpy() for o in out])
        return {q: np.stack([r[j] for r in rows]) for j, q in enumerate(self.questions)}

    def info(self) -> dict:
        return {"device": str(self.device), "dtype": str(self.dt).replace("torch.", ""), "kernel": self.kernel,
                "graphs": self.graphs, "recorded": self.recorded, **({"notes": self.notes} if self.notes else {})}
