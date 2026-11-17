import numpy as np
import pytest
from PIL import Image
from tiny import MISSIONS, make_checkpoint


@pytest.fixture(scope="session")
def tiny_checkpoint(tmp_path_factory):
    return make_checkpoint(tmp_path_factory.mktemp("tiny"))


@pytest.fixture(scope="session")
def tiny_images():
    rng = np.random.default_rng(1)
    return [Image.fromarray(rng.integers(0, 255, (96, 128, 3), dtype=np.uint8)) for _ in MISSIONS]
