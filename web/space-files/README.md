---
title: Jevol
emoji: 🛸
colorFrom: gray
colorTo: gray
sdk: static
app_file: index.html
pinned: false
license: other
license_name: racine-research-license
license_link: LICENSE.md
short_description: A drone flown by a small VLM in your browser
---

# Jevol

A drone in a simulated world, flown by Jevol, a small vision-language model by Racine.ai. The model sees only the
drone camera and your mission, written in English. Every 0.4 s it chooses a speed, a turn and a climb.

Everything runs in your browser with WebGPU: the simulation (three.js) and the model (ONNX Runtime Web). The first
visit downloads about 570 MB; the browser keeps it in its cache for the next visits.

Requirements: a computer with Chrome or Edge and WebGPU. Firefox, iPhone and iPad are not supported.

Model: Jevol 0.6B (Qwen3.5 0.8B cut to 12 layers, LoRA, sentence head), int8 decoder, fp16 vision.

Map: fictional. Surface textures: CC0 (Poly Haven, ambientCG), see `models/surfaces/LICENSES.md`.
Racine.ai logo: see `textures/racine/SOURCE.md`.

## Licence

The Jevol weights, configuration files, code and documentation in this Space are licensed under the
[Racine Research License, version 1.0](LICENSE.md): research use is free, including inside companies; operational or
commercial use needs a separate written licence from Racine.ai. Jevol is derived from Qwen3.5-0.8B (Apache License 2.0,
see [NOTICE](NOTICE) and [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)).

Jevol outputs flight commands and is evaluated in simulation only. It is not certified for flight. If you connect it to a
real aircraft, you are responsible for the flight: keep a trained pilot able to take control at any moment, follow the
regulations, put independent safety limits outside the model, and keep people away from the flight path.
