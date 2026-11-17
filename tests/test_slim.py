import importlib.util
import json
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "slim_checkpoint.py"


def load_script():
    spec = importlib.util.spec_from_file_location("slim_checkpoint", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_slim_drops_lm_head_and_halves_head(tiny_checkpoint, tmp_path):
    out = tmp_path / "slim"
    report = load_script().slim(tiny_checkpoint, out)
    assert report["dropped"] == ["lm_head.weight"]
    before, after = load_file(str(tiny_checkpoint / "model.safetensors")), load_file(str(out / "model.safetensors"))
    assert "lm_head.weight" not in after and set(after) == set(before) - {"lm_head.weight"}
    for k, v in after.items():
        assert np.array_equal(v, before[k])
    head = load_file(str(out / "sentence_head.safetensors"))
    ref = load_file(str(tiny_checkpoint / "sentence_head.safetensors"))
    assert all(v.dtype == np.float16 for v in head.values())
    assert np.allclose(head["rows"].astype(np.float32), ref["rows"], atol=1e-2)
    assert json.loads((out / "jevol_config.json").read_text())["readout"]["kind"] == "head"
