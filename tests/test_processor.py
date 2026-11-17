from jevol.processor import smart_resize


def test_camera_size_maps_to_patch_grid():
    assert smart_resize(504, 672, 32, 65536, 16777216) == (512, 672)


def test_large_image_is_scaled_down():
    h, w = smart_resize(504, 672, 32, 4096, 16384)
    assert h * w <= 16384 and h % 32 == 0 and w % 32 == 0
