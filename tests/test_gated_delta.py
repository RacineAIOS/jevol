import pytest

torch = pytest.importorskip("torch")

import torch.nn.functional as F

from jevol.backends.cuda import gated_delta, gated_delta_reference


@pytest.mark.parametrize("chunk", [8, 64])
@pytest.mark.parametrize("with_state", [False, True])
def test_chunked_rule_matches_recurrence(chunk, with_state):
    g = torch.Generator().manual_seed(0)
    b, t, h, dk, dv = 2, 70, 3, 16, 8
    q = F.normalize(torch.randn(b, t, h, dk, generator=g), dim=-1) * dk ** -0.5
    k = F.normalize(torch.randn(b, t, h, dk, generator=g), dim=-1)
    v = torch.randn(b, t, h, dv, generator=g)
    log_g = -torch.rand(b, t, h, generator=g) * 0.2
    beta = torch.rand(b, t, h, generator=g)
    state = torch.randn(b, h, dk, dv, generator=g) if with_state else None
    out, final = gated_delta(q, k, v, log_g, beta, state, chunk=chunk)
    ref_out, ref_final = gated_delta_reference(q, k, v, log_g, beta, state)
    assert torch.allclose(out, ref_out, atol=1e-5)
    assert torch.allclose(final, ref_final, atol=1e-5)
