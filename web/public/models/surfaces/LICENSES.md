# Surface textures

All textures are CC0 1.0 (public domain, https://creativecommons.org/publicdomain/zero/1.0/). License read on 2026-11-10 at
https://polyhaven.com/license ("Our assets are all licensed as CC0") and at https://ambientcg.com (CC0).

Two files, assembled offline as a 2 x 2 atlas (1024 px cells: each tile reduced to 960 px, with a 32 px border copied with
wrap-around): `surfaces_color_2k.jpg` (color, sRGB) and `surfaces_nr_2k.jpg` (R, G = normal x, y in OpenGL convention;
B = roughness), JPEG without chroma subsampling.

| Cell (v = 0 at the bottom) | Title | Author | Address | License | Downloaded | Real tile size |
| --- | --- | --- | --- | --- | --- | --- |
| 0, bottom left | Concrete034 (stretched from 1024 x 512 to 960 x 960) | ambientCG | https://ambientcg.com/view?id=Concrete034 | CC0 1.0 | 2026-11-10 | 2 x 1 m |
| 1, bottom right | Concrete Layers 02 (1K JPG: diff, nor_gl, rough) | Rob Tuytel | https://polyhaven.com/a/concrete_layers_02 | CC0 1.0 | 2026-11-10 | 2 x 2 m |
| 2, top left | Concrete Debris (1K JPG: diff, nor_gl, rough) | Amal Kumar | https://polyhaven.com/a/concrete_debris | CC0 1.0 | 2026-11-10 | 2 x 2 m |
| 3, top right | Rough Wood (1K JPG: diff, nor_gl, rough) | Rob Tuytel | https://polyhaven.com/a/rough_wood | CC0 1.0 | 2026-11-10 | 0.5 x 0.5 m |

Download: 9 JPEG 1K files taken one by one from dl.polyhaven.org, 6,136,678 bytes in total. Size in this repository:
2.75 MB (two files).
