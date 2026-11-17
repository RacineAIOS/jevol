from __future__ import annotations

import numpy as np

SPEEDS = np.array([-1.5, 0.0, 1.5, 3.0])
SPEED_NAMES = ["fly backward", "stay in place", "fly forward slowly", "fly forward fast"]
TURNS = np.radians(np.array([60.0, 30.0, 0.0, -30.0, -60.0]))
TURN_NAMES = ["turn hard left", "turn left", "keep heading", "turn right", "turn hard right"]
CLIMBS = np.array([-1.5, -0.75, 0.0, 0.75, 1.5])
CLIMB_NAMES = ["descend fast", "descend", "hold altitude", "climb", "climb fast"]
SIDES = np.array([-1.0, 0.0, 1.0])
SIDE_NAMES = ["slide left", "no sideways move", "slide right"]
SIGMA_SPEED, SIGMA_TURN = 0.7, np.radians(14.0)

QUESTIONS = {
    "move": "Which way should the drone fly next?",
    "altitude": "Should the drone climb, descend or hold its altitude?",
    "side": "Should the drone slide sideways?",
}
OPTION_NAMES = {
    "move": [f"{s}, {t}" for s in SPEED_NAMES for t in TURN_NAMES],
    "altitude": CLIMB_NAMES,
    "side": SIDE_NAMES,
}
SPEED_DEAD = 0.4


def ml_axis(p, centres, sigma, lo, hi, n=121) -> float:
    vs = np.linspace(lo, hi, n)
    q = np.exp(-0.5 * ((centres[None, :] - vs[:, None]) / sigma) ** 2)
    q /= q.sum(1, keepdims=True)
    return float(vs[np.argmax((np.log(q + 1e-12) * p[None, :]).sum(1))])


def decode(p_move, p_altitude, p_side) -> dict:
    grid = np.asarray(p_move, float).reshape(len(SPEEDS), len(TURNS))
    forward = ml_axis(grid.sum(1), SPEEDS, SIGMA_SPEED, SPEEDS[0], SPEEDS[-1])
    yaw = ml_axis(grid.sum(0), TURNS, SIGMA_TURN, TURNS.min(), TURNS.max())
    if abs(forward) < SPEED_DEAD:
        forward = 0.0
    up = float(CLIMBS[int(np.argmax(p_altitude))])
    right = float(SIDES[int(np.argmax(p_side))]) if p_side is not None else 0.0
    return {"forward": forward, "yaw": yaw, "up": up, "right": right}
