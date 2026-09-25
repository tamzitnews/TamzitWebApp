#!/usr/bin/env python3
"""Generate Tamzit app icons / splash / notification icon from the brand mark.

The only raster sources are low-res (mark PNG 124x143, vertical logo JPEG with the
mark at ~236x275). The mark is flat-colour art, so instead of a blurry LANCZOS
blow-up we:
  1. crop the mark from the (higher-res) vertical logo JPEG,
  2. compute soft per-colour memberships against the brand palette (each blended
     edge pixel is split between the two palette colours it lies between),
  3. upscale each membership map smoothly, argmax -> crisp flat regions with
     sub-pixel-accurate smooth contours,
  4. render at 4x and downsample (premultiplied) for anti-aliased edges.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/user/TamzitWebApp")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / "mobile/assets/images")
SRC = ROOT / "design-system/assets/Logos/tamzit-logo-vertical.jpg"
CROP = (176, 36, 440, 338)  # mark bbox in the JPEG is x 190-426, y 50-324

BG = (0xF2, 0xFA, 0xFD)  # app background / adaptive icon background
NAVY_BRAND = (0x1C, 0x3F, 0x79)

# name, rgb, class kind
PALETTE = [
    ("bg", (255, 255, 255)),
    ("circle", (0xC7, 0xE8, 0xF6)),
    ("navy", (0x18, 0x25, 0x51)),
    ("headline", (0x1E, 0x41, 0x7B)),
    ("paper", (0x9E, 0xDB, 0xF8)),
    ("bright", (0x28, 0xA9, 0xE0)),
    ("roll", (0x10, 0x7B, 0xBF)),
]
NAMES = [p[0] for p in PALETTE]
P = np.array([p[1] for p in PALETTE], float)
K = len(P)


def memberships(rgb):
    h, w, _ = rgb.shape
    d = np.sqrt(((rgb[:, :, None, :] - P[None, None]) ** 2).sum(-1))  # h,w,K
    nearest = d.argmin(-1)
    conf = d.min(-1) < 30
    present = np.zeros((h, w, K), bool)
    for k in range(K):
        present[:, :, k] = ndimage.maximum_filter((nearest == k) & conf, size=7)
    best = np.full((h, w), np.inf)
    M = np.zeros((h, w, K))
    choice_i = np.zeros((h, w), int)
    choice_j = np.zeros((h, w), int)
    choice_t = np.zeros((h, w))
    for i in range(K):
        for j in range(i, K):
            ok = present[:, :, i] & present[:, :, j]
            if i == j:
                t = np.zeros((h, w))
                dist = d[:, :, i]
            else:
                ab = P[j] - P[i]
                t = np.clip(((rgb - P[i]) * ab).sum(-1) / (ab @ ab), 0, 1)
                proj = P[i] + t[..., None] * ab
                dist = np.sqrt(((rgb - proj) ** 2).sum(-1))
            better = ok & (dist < best)
            best[better] = dist[better]
            choice_i[better], choice_j[better], choice_t[better] = i, j, t[better]
    none = ~np.isfinite(best)
    choice_i[none] = choice_j[none] = nearest[none]
    choice_t[none] = 0
    ii, jj = np.indices((h, w))
    np.add.at(M, (ii, jj, choice_i), 1 - choice_t)
    np.add.at(M, (ii, jj, choice_j), choice_t)
    return M


def render_labels(M, scale, blur_src_px=1.15, dark_split_blur_px=2.2):
    """Upscale memberships and argmax. navy vs headline differ only slightly, so
    their mutual boundary is decided from a more strongly smoothed ratio."""
    h, w, _ = M.shape
    W, H = int(round(w * scale)), int(round(h * scale))
    NAV, HEAD = NAMES.index("navy"), NAMES.index("headline")

    def up(a, sigma):
        im = Image.fromarray(a.astype(np.float32), "F").resize((W, H), Image.BICUBIC)
        return ndimage.gaussian_filter(np.asarray(im), sigma * scale)

    merged = M.copy()
    merged[:, :, NAV] += merged[:, :, HEAD]
    merged[:, :, HEAD] = 0
    best = np.zeros((H, W), np.int64)
    bestv = np.full((H, W), -np.inf, np.float32)
    for k in range(K):
        if k == HEAD:
            continue
        v = up(merged[:, :, k], blur_src_px)
        better = v > bestv
        best[better] = k
        bestv[better] = v[better]
    del bestv
    ratio = M[:, :, HEAD] / np.maximum(M[:, :, NAV] + M[:, :, HEAD], 1e-6)
    ratio = np.where(M[:, :, NAV] + M[:, :, HEAD] > 1e-3, ratio, 0.0)
    r = up(ratio, dark_split_blur_px)
    best[(best == NAV) & (r > 0.5)] = HEAD
    return best


def main():
    src = np.asarray(Image.open(SRC).convert("RGB").crop(CROP)).astype(float)
    M = memberships(src)

    SS = 4  # supersampling
    target_h = 1400  # master mark height (px) before supersampling
    scale = target_h * SS / src.shape[0]
    lab = render_labels(M, scale)

    # Geometric clean-up: the disc is a true circle and the base a true ellipse.
    BGI, CIR, NAV = 0, NAMES.index("circle"), NAMES.index("navy")

    def boundary(a, b):
        nb = np.zeros_like(lab, bool)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nb |= np.roll(lab == b, (dy, dx), (0, 1))
        return np.nonzero((lab == a) & nb)

    ys_, xs_ = boundary(CIR, BGI)
    A = np.stack([xs_, ys_, np.ones_like(xs_)], 1).astype(float)
    bvec = (xs_.astype(float) ** 2 + ys_.astype(float) ** 2)
    cx2, cy2, c = np.linalg.lstsq(A, bvec, rcond=None)[0]
    ccx, ccy = cx2 / 2, cy2 / 2
    cr = np.sqrt(c + ccx ** 2 + ccy ** 2)
    yy, xx = np.indices(lab.shape)
    disc = (xx - ccx) ** 2 + (yy - ccy) ** 2 <= cr ** 2
    # base ellipse: navy/bg boundary outside the disc (below it)
    ys_, xs_ = boundary(NAV, BGI)
    sel = ((xs_ - ccx) ** 2 + (ys_ - ccy) ** 2 > (cr * 1.02) ** 2) & (ys_ > ccy)
    ex, ey = xs_[sel].astype(float), ys_[sel].astype(float)
    # axis-aligned conic: a x^2 + b y^2 + c x + d y = 1
    A = np.stack([ex ** 2, ey ** 2, ex, ey], 1)
    a_, b_, c_, d_ = np.linalg.lstsq(A, np.ones_like(ex), rcond=None)[0]
    ex0, ey0 = -c_ / (2 * a_), -d_ / (2 * b_)
    g = 1 + a_ * ex0 ** 2 + b_ * ey0 ** 2
    erx, ery = np.sqrt(g / a_), np.sqrt(g / b_)
    ell = ((xx - ex0) / erx) ** 2 + ((yy - ey0) / ery) ** 2 <= 1
    print(f"circle c=({ccx:.0f},{ccy:.0f}) r={cr:.0f}; ellipse c=({ex0:.0f},{ey0:.0f}) r=({erx:.0f},{ery:.0f})")
    outside = ~disc & ~ell
    lab[(lab == BGI) & disc] = CIR
    lab[(lab == BGI) & ell & ~disc] = NAV
    # anything outside both shapes that is not part of the roll itself -> bg
    lab[outside & ((lab == CIR) | (lab == NAV))] = BGI
    del yy, xx

    # everything that is not background is the mark; fill any interior holes
    solid = ndimage.binary_fill_holes(lab != 0)
    # interior pixels mislabelled as bg -> nearest non-bg label
    holes = solid & (lab == 0)
    if holes.any():
        idx = ndimage.distance_transform_edt(lab == 0, return_distances=False, return_indices=True)
        lab = np.where(holes, lab[idx[0], idx[1]], lab)
    ys, xs = np.nonzero(solid)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    lab = lab[y0:y1, x0:x1]
    solid = solid[y0:y1, x0:x1]

    def to_rgba(label_colors, alpha_mask):
        rgb = np.zeros(lab.shape + (3,), np.uint8)
        for k, c in label_colors.items():
            rgb[lab == k] = c
        a = (alpha_mask * 255).astype(np.uint8)
        im = Image.fromarray(np.dstack([rgb, a]), "RGBA").convert("RGBa")
        im = im.resize((im.width // SS, im.height // SS), Image.LANCZOS)
        return im.convert("RGBA")

    colors = {k: tuple(int(v) for v in P[k]) for k in range(1, K)}
    mark = to_rgba(colors, solid)  # full-colour mark, transparent bg

    # Glyph (for monochrome / notification): the newspaper roll drawing without
    # the light circle behind it and without light fills -> dark strokes + base.
    dark = np.isin(lab, [NAMES.index(n) for n in ("navy", "headline", "roll")])
    glyph_white = to_rgba({k: (255, 255, 255) for k in range(1, K)}, dark)
    OUT.mkdir(parents=True, exist_ok=True)

    def fit(img, box_w, box_h):
        s = min(box_w / img.width, box_h / img.height)
        return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)

    def enclosing_center_radius(img):
        a = np.asarray(img)[:, :, 3] > 8
        ys, xs = np.nonzero(a)
        pts = np.stack([xs, ys], 1).astype(float)
        best = None
        cx0, cy0 = img.width / 2, img.height / 2
        for cx in np.linspace(cx0 - img.width * 0.1, cx0 + img.width * 0.1, 41):
            for cy in np.linspace(cy0 - img.height * 0.1, cy0 + img.height * 0.1, 41):
                r = np.sqrt(((pts - (cx, cy)) ** 2).sum(1)).max()
                if best is None or r < best[0]:
                    best = (r, cx, cy)
        return best

    def place_in_circle(img, canvas, diameter, bg=None):
        """Scale img so its min enclosing circle has `diameter`, centred on canvas."""
        r, cx, cy = enclosing_center_radius(img)
        s = (diameter / 2) / r
        im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
        out = Image.new("RGBA", (canvas, canvas), bg + (255,) if bg else (0, 0, 0, 0))
        out.alpha_composite(im, (round(canvas / 2 - cx * s), round(canvas / 2 - cy * s)))
        return out

    # 1. Legacy / iOS / store icon: mark on #F2FAFD, full bleed square, padded
    icon = Image.new("RGBA", (1024, 1024), BG + (255,))
    m = fit(mark, 1024 * 0.72, 1024 * 0.72)
    icon.alpha_composite(m, ((1024 - m.width) // 2, (1024 - m.height) // 2))
    icon.convert("RGB").save(OUT / "icon.png", optimize=True)

    # 2. Adaptive icon foreground: 108dp canvas, safe zone = 66dp circle (61%).
    fg = place_in_circle(mark, 1024, 1024 * 0.60)
    fg.save(OUT / "android-icon-foreground.png", optimize=True)

    # 3. Monochrome (themed icon): single colour glyph, same placement rules.
    mono = place_in_circle(glyph_white, 1024, 1024 * 0.56)
    mono.save(OUT / "android-icon-monochrome.png", optimize=True)

    # 4. Splash image: the mark on transparent bg (bg colour set in app.json)
    splash = fit(mark, 1024, 1024)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(splash, ((1024 - splash.width) // 2, (1024 - splash.height) // 2))
    canvas.save(OUT / "splash-icon.png", optimize=True)

    # 5. Notification small icon: 96x96 all-white glyph with transparency.
    notif = place_in_circle(glyph_white, 96, 96 * 0.94)
    notif.save(OUT / "notification-icon.png", optimize=True)

    # 6. Web favicon
    fav = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
    f = fit(mark, 46, 46)
    fav.alpha_composite(f, ((48 - f.width) // 2, (48 - f.height) // 2))
    fav.save(OUT / "favicon.png", optimize=True)

    # previews for review
    prev = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    if prev:
        mark.save(prev / "mark-master.png")
        glyph_white.save(prev / "glyph-white.png")
    print("mark master size", mark.size)


if __name__ == "__main__":
    main()
