# Third-party notices

This repository holds code and assets by Racine.ai under the Racine Research License (`LICENSE.md`), and the third-party
items below under their own licences. Model weights are not in this repository.

## Base models

| Item | Use | Licence |
| --- | --- | --- |
| Qwen/Qwen3.5-0.8B (Alibaba Cloud) | base of Jevol-0.6B and Jevol-0.9B | Apache License 2.0, `LICENSES/Apache-2.0.txt` |
| Qwen/Qwen3.5-2B (Alibaba Cloud) | base of Jevol-2B | Apache License 2.0, `LICENSES/Apache-2.0.txt` |

See `NOTICE` for the changes Racine.ai made to the base models.

## Code in `jevol/`

| Item | Use | Licence |
| --- | --- | --- |
| Qwen3.5 model architecture, as implemented in Hugging Face transformers 5.17 | `jevol/backends/mlx.py` and `jevol/backends/cuda.py` reimplement its forward pass for inference | Apache License 2.0 |
| Qwen2-VL image processor (Hugging Face transformers) and the Pillow bicubic filter | `jevol/processor.py` reproduces their image resizing, normalisation, patch layout and position ids | Apache License 2.0 (transformers), MIT-CMU (Pillow) |
| PlayJev prompt layout (OmniJev/PlayJev) | `jevol/prompt.py` builds the prompt in the layout the model was trained with | Apache License 2.0 |

## Python dependencies (installed by pip, not in this repository)

| Package | Extra | Licence |
| --- | --- | --- |
| NumPy | base | BSD 3-Clause |
| Pillow | base | MIT-CMU |
| tokenizers (Hugging Face) | base | Apache License 2.0 |
| MLX, mlx-lm (Apple) | `mlx` | MIT |
| transformers (Hugging Face), installed by mlx-lm | `mlx` | Apache License 2.0 |
| PyTorch | `cuda` | BSD 3-Clause |
| safetensors (Hugging Face) | `cuda` | Apache License 2.0 |
| flash-linear-attention | `fla` | MIT |
| aiohttp | `server` | Apache License 2.0 |
| pytest | `test` | MIT |

## Web simulator in `web/`

| Item | Use | Licence |
| --- | --- | --- |
| three.js 0.186.1 | 3D engine, installed by pnpm | MIT |
| `web/src/engine/vendor/SkyMesh.js` | sky, from the three.js examples | MIT |
| Vite 8.3.4 | build tool (development only), installed by pnpm | MIT |
| ONNX Runtime Web 1.31.1 | in-browser model, loaded at run time from cdn.jsdelivr.net (not in this repository) | MIT |
| @huggingface/tokenizers 0.2.0 | in-browser tokenizer, loaded at run time from cdn.jsdelivr.net (not in this repository) | Apache License 2.0 |
| Surface textures `web/public/models/surfaces/` | ground and wall materials | CC0 1.0, provenance below |
| Racine.ai wordmark `web/public/textures/racine/` | page header and map billboards | not under an open licence, see below |

### Surface textures

All textures are CC0 1.0 (public domain, https://creativecommons.org/publicdomain/zero/1.0/). The full provenance is in
`web/public/models/surfaces/LICENSES.md`.

| Cell | Title | Author | Address | Licence | Downloaded |
| --- | --- | --- | --- | --- | --- |
| 0 | Concrete034 | ambientCG | https://ambientcg.com/view?id=Concrete034 | CC0 1.0 | 2026-11-10 |
| 1 | Concrete Layers 02 | Rob Tuytel | https://polyhaven.com/a/concrete_layers_02 | CC0 1.0 | 2026-11-10 |
| 2 | Concrete Debris | Amal Kumar | https://polyhaven.com/a/concrete_debris | CC0 1.0 | 2026-11-10 |
| 3 | Rough Wood | Rob Tuytel | https://polyhaven.com/a/rough_wood | CC0 1.0 | 2026-11-10 |

### Racine.ai wordmark

The Racine.ai logo and name belong to Racine.ai. They are not under an open licence and are used here with the agreement
of Racine.ai. Do not reuse them outside this repository without the agreement of Racine.ai. Source and changes:
`web/public/textures/racine/SOURCE.md`.

## Map

The map of the simulator is fictional and generated. It holds no real place data. The tutorial video and images in
`web/public/tutorial/`, `examples/street.jpg` and `docs/flight.gif` are captures of this simulator.
