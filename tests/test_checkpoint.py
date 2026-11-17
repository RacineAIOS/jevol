import json
import shutil

import pytest

from jevol.checkpoint import check, read_meta


def test_reads_new_and_old_config_names(tiny_checkpoint, tmp_path):
    old = tmp_path / "old"
    shutil.copytree(tiny_checkpoint, old)
    (old / "jevol_config.json").rename(old / "playjev_train.json")
    assert read_meta(old) == read_meta(tiny_checkpoint)
    assert check(old)[2] == ("move", "altitude", "side")


def test_rejects_other_options(tiny_checkpoint, tmp_path):
    bad = tmp_path / "bad"
    shutil.copytree(tiny_checkpoint, bad)
    meta = json.loads((bad / "jevol_config.json").read_text())
    meta["options"]["altitude"].reverse()
    (bad / "jevol_config.json").write_text(json.dumps(meta))
    with pytest.raises(ValueError, match="altitude"):
        check(bad)


def test_reports_missing_files(tmp_path):
    with pytest.raises(FileNotFoundError, match="model.safetensors"):
        check(tmp_path)
