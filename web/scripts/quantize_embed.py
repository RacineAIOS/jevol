import json
import sys
from pathlib import Path

import numpy as np

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
meta = json.loads((dst / "jevol.json").read_text())
rows, dim = meta["embed"]["rows"], meta["embed"]["dim"]
x = np.fromfile(src / meta["embed"]["file"], dtype=np.float16).reshape(rows, dim).astype(np.float32)
scale = (np.abs(x).max(1) / 127.0).astype(np.float16)
divisor = np.where(scale.astype(np.float32) == 0, 1.0, scale.astype(np.float32))
q = np.clip(np.rint(x / divisor[:, None]), -127, 127).astype(np.int8)
out = np.empty((rows, dim + 2), dtype=np.uint8)
out[:, :2] = scale.view(np.uint8).reshape(rows, 2)
out[:, 2:] = q.view(np.uint8)
out.tofile(dst / "embed.i8.bin")
meta["embed"] = {"file": "embed.i8.bin", "rows": rows, "dim": dim, "dtype": "int8", "rowBytes": dim + 2}
(dst / "jevol.json").write_text(json.dumps(meta))
