import numpy as np
import pytest

from jevol import actions


def one_hot(n, i, mass=0.97):
    p = np.full(n, (1 - mass) / (n - 1))
    p[i] = mass
    return p


def test_decode_forward_fast_and_climb():
    move = actions.OPTION_NAMES["move"].index("fly forward fast, keep heading")
    cmd = actions.decode(one_hot(20, move), one_hot(5, 3), one_hot(3, 2))
    assert cmd["forward"] == pytest.approx(3.0, abs=0.1)
    assert cmd["yaw"] == pytest.approx(0.0, abs=0.05)
    assert cmd["up"] == 0.75
    assert cmd["right"] == 1.0


def test_decode_turn_sign_and_speed_dead_zone():
    move = actions.OPTION_NAMES["move"].index("stay in place, turn hard left")
    cmd = actions.decode(one_hot(20, move), one_hot(5, 2), None)
    assert cmd["forward"] == 0.0
    assert cmd["yaw"] > 0.8
    assert cmd["up"] == 0.0 and cmd["right"] == 0.0


def test_option_names_match_grid():
    assert len(actions.OPTION_NAMES["move"]) == len(actions.SPEEDS) * len(actions.TURNS)
    assert actions.OPTION_NAMES["move"][0] == "fly backward, turn hard left"
