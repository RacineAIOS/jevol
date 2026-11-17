SYSTEM = "Read the state, then give only the action to take."
FRAME = "<|vision_start|><|image_pad|><|vision_end|>"
STATE_PREFIX = "Mission: "


def build_prompt(question: str, mission: str) -> str:
    state = "\n".join([FRAME, (STATE_PREFIX + mission).strip()])
    return f"{SYSTEM}\n\n<state>\n{state}\n</state>\n\nQuestion: {question}\nAnswer:"
