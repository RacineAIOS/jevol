import numpy as np
import pytest
from tiny import MISSIONS

from jevol import Policy


def scores(backend, checkpoint, images, **options):
    policy = Policy(checkpoint, backend, dtype="float32", **options)
    return policy, policy.probabilities(images, MISSIONS)


@pytest.fixture(scope="module")
def cpu_mlx():
    mx = pytest.importorskip("mlx.core")
    before = mx.default_device()
    mx.set_default_device(mx.cpu)
    yield
    mx.set_default_device(before)


@pytest.fixture(scope="module")
def cpu_torch():
    torch = pytest.importorskip("torch")
    torch.set_num_threads(2)


def test_mlx_matches_torch(tiny_checkpoint, tiny_images, cpu_mlx, cpu_torch):
    _, a = scores("mlx", tiny_checkpoint, tiny_images)
    _, b = scores("cuda", tiny_checkpoint, tiny_images, device="cpu")
    for q in ("move", "altitude", "side"):
        assert a[q].shape == b[q].shape == (len(MISSIONS), len(a[q][0]))
        assert np.abs(a[q] - b[q]).max() < 1e-4, q


def test_batch_equals_single(tiny_checkpoint, tiny_images, cpu_torch):
    policy, batch = scores("cuda", tiny_checkpoint, tiny_images, device="cpu")
    for i, (image, mission) in enumerate(zip(tiny_images, MISSIONS)):
        single = policy.probabilities([image], [mission])
        for q in policy.questions:
            assert np.abs(single[q][0] - batch[q][i]).max() < 1e-6


def test_act_returns_commands(tiny_checkpoint, tiny_images, cpu_torch):
    policy = Policy(tiny_checkpoint, "cuda", device="cpu")
    result = policy.act(tiny_images[:1], MISSIONS[:1])[0]
    assert set(result) >= {"forward", "yaw", "up", "right", "top", "probs"}
    assert abs(sum(result["probs"]["move"]) - 1) < 1e-3
