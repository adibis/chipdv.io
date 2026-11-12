#!/usr/bin/env python3
"""Draw the diagrams the CSR flows play across.

Two drawings: the register-access view (every component one RAL access
touches, from the sequence to the flops and back through the predictor)
and a timing view of one frontdoor write (the same components as
lifelines, in time order). Every block and arrow sits in a <g id="...">
so a data/flows/*.yaml scenario can light it or move a token along it.

Also writes assets/css/flow-svg-dark.css. The site darkens <img> diagrams
with an invert + hue-rotate filter; the player inlines the SVG instead, so
the same transform is applied per colour, and a diagram looks the same in
the page and in the player.

Run from anywhere: python3 svg/build/csr_flows.py
"""
import re
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# The site's diagrams embed their font; reuse the same <defs><style> block
# so these match them exactly.
_ref = (REPO / "static/images/csr/01-ral-dataflow.svg").read_text()
FONT_DEFS = re.search(r"<defs><style>.*?</style></defs>", _ref, re.S).group(0)
FONT_ATTR = re.search(r'<svg [^>]*?(font-family="[^"]*")', _ref).group(1)

INK = "#0f172a"
SUB = "#64748b"
BLUE = "#0369a1"
AMBER = "#df8e1d"
MUTED = "#94a3b8"

STYLE = {  # kind -> fill, stroke, title, subtitle, dashed
    "tb": ("#f0f9ff", BLUE, INK, SUB, False),
    "val": ("#ffffff", BLUE, INK, SUB, False),
    "comp": ("#fffbeb", AMBER, INK, SUB, False),
    "hw": ("#f8fafc", "#334155", INK, SUB, False),
    "plain": ("#f8fafc", MUTED, INK, SUB, True),
}


class Svg:
    def __init__(self, w, h, marker):
        self.w, self.h, self.mk = w, h, marker
        self.out, self.links = [], []

    def text(self, x, y, s, size=15, fill=INK, weight=None, anchor="middle", into=None):
        wt = f' font-weight="{weight}"' if weight else ""
        (self.out if into is None else into).append(
            f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" color="{fill}"{wt} '
            f'text-anchor="{anchor}">{escape(s)}</text>')

    def rect(self, x, y, w, h, fill, stroke, dash=False, rx=6, sw=1.5):
        d = ' stroke-dasharray="5,4"' if dash else ""
        self.out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
                        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def frame(self, x, y, w, h, title):
        self.rect(x, y, w, h, "#ffffff", "#cbd5e1", rx=10, sw=1.2)
        self.text(x + 14, y + 24, title, 15, BLUE, 500, "start")

    def block(self, id, x, y, w, h, title, sub=None, kind="tb", title_y=None):
        fill, stroke, tc, sc, dash = STYLE[kind]
        self.out.append(f'<g id="{id}">')
        self.rect(x, y, w, h, fill, stroke, dash)
        cx = x + w // 2
        if title_y is not None:
            self.text(cx, y + title_y, title, 15, tc, 500)
        elif sub:
            self.text(cx, y + h // 2 - 3, title, 15, tc, 500)
            self.text(cx, y + h // 2 + 15, sub, 12, sc)
        else:
            self.text(cx, y + h // 2 + 5, title, 15, tc, 500)
        self.out.append("</g>")

    def link(self, id, d, label=None, lx=None, ly=None, colour=BLUE, dash=False, anchor="middle"):
        mk = self.mk + ("-muted" if colour == MUTED else "")
        ds = ' stroke-dasharray="5,4"' if dash else ""
        self.links.append(f'<g id="{id}">')
        self.links.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="1.5"{ds} '
                          f'marker-end="url(#{mk})"/>')
        if label:
            self.text(lx, ly, label, 12, colour, anchor=anchor, into=self.links)
        self.links.append("</g>")

    def write(self, path):
        defs = "".join(
            f'<marker id="{self.mk}{sfx}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
            for sfx, c in (("", BLUE), ("-muted", MUTED)))
        body = "\n".join(self.out + self.links)
        path.write_text(f'<svg viewBox="0 0 {self.w} {self.h}" xmlns="http://www.w3.org/2000/svg" '
                        f'{FONT_ATTR}>{FONT_DEFS}\n<defs>{defs}</defs>\n{body}\n</svg>\n')


# ------------------------------------------------------------------ access view
def access_view():
    s = Svg(1440, 640, "arr-csr")
    s.text(720, 34, "One register access, end to end", 20, INK, 500)
    s.text(720, 58, "A RAL write or read from the sequence to the flops, and how the mirror hears about it",
           13, MUTED)

    s.frame(20, 80, 200, 330, "Test")
    s.block("block-seq", 34, 124, 172, 76, "Sequence", "write, read, mirror")

    s.frame(250, 80, 370, 330, "Register model")
    s.block("block-reg", 266, 118, 190, 170, "uvm_reg CTRL", kind="tb", title_y=24)
    s.block("block-desired", 280, 154, 162, 50, "desired", "what the test wants", "val")
    s.block("block-mirrored", 280, 220, 162, 50, "mirrored", "what it thinks the DUT has", "val")
    s.block("block-cbs", 488, 118, 118, 74, "Callbacks", "pre/post_write")
    s.block("block-map", 488, 214, 118, 74, "Reg map", "CTRL at 'h10")
    s.text(520, 322, "fields: EN[0] RW,", 12, SUB)
    s.text(520, 340, "MODE[2:1] RW,", 12, SUB)
    s.text(520, 358, "DONE[8] W1C, volatile", 12, SUB)

    s.block("block-adapter", 660, 214, 180, 74, "Adapter", "reg2bus, bus2reg", "comp")

    s.frame(880, 80, 240, 330, "APB agent")
    s.block("block-sqr", 896, 118, 208, 56, "Sequencer")
    s.block("block-drv", 896, 214, 208, 74, "Driver", "drives the pins")
    s.block("block-mon", 896, 330, 208, 62, "Monitor", "analysis port")

    s.frame(1160, 80, 240, 410, "DUT")
    s.block("block-apb", 1176, 214, 208, 74, "APB slave", "decodes 'h10 to CTRL", "hw")
    s.block("block-flops", 1176, 318, 208, 56, "CTRL flops", None, "hw")
    s.block("block-hwlogic", 1176, 412, 208, 62, "Hardware logic", "sets DONE when done", "hw")

    s.block("block-pred", 660, 470, 460, 64, "Predictor", "bus2reg, find the register by address, predict", "comp")

    # request path, left to right
    s.link("arrow-seq-reg", "M206,148 H264", "call", 236, 140)
    s.link("arrow-reg-map", "M456,240 H486")
    s.link("arrow-map-adapter", "M606,240 H658", "bus_op", 632, 232)
    s.link("arrow-adapter-sqr", "M750,214 V146 H894", "start_item", 822, 138)
    s.link("arrow-sqr-drv", "M1000,174 V212", "get_next_item", 1010, 198, anchor="start")
    s.link("arrow-drv-apb", "M1104,232 H1174", "PWDATA", 1140, 225)
    # response path, right to left
    s.link("arrow-apb-drv", "M1176,272 H1106", "PRDATA", 1140, 266)
    s.link("arrow-drv-adapter", "M896,272 H842", "done", 869, 266)
    s.link("arrow-adapter-map", "M660,272 H608", "status", 634, 266)
    s.link("arrow-map-reg", "M488,272 H458")
    s.link("arrow-reg-seq", "M266,184 H208", "status", 236, 178)
    # inside the DUT
    s.link("arrow-apb-flops", "M1256,288 V316", "write", 1248, 307, anchor="end")
    s.link("arrow-flops-apb", "M1304,318 V290", "read", 1312, 307, anchor="start")
    s.link("arrow-hw-flops", "M1280,412 V376", "set DONE", 1290, 399, anchor="start")
    # observation path
    s.link("arrow-apb-mon", "M1176,282 H1140 V361 H1106", "pins", 1146, 330, anchor="start")
    s.link("arrow-mon-pred", "M1000,392 V468", "write(item)", 1010, 436, anchor="start")
    s.link("arrow-pred-mirror", "M660,502 H361 V272", "predict()", 510, 494)
    # backdoor
    s.link("arrow-backdoor", "M300,288 V600 H1420 V346 H1386",
           "backdoor: hdl_read / hdl_write straight to the flops, no bus", 860, 592,
           colour=MUTED, dash=True)
    s.write(REPO / "static/images/csr/flow-access-view.svg")
    return s


# ------------------------------------------------------------------ timing view
LANES = [("seq", "Sequence"), ("reg", "uvm_reg"), ("map", "Map + adapter"),
         ("drv", "Sequencer, driver"), ("dut", "DUT"), ("pred", "Monitor, predictor")]


def timing_view():
    w, lane_w = 1440, 200
    xs = {k: 120 + i * 240 for i, (k, _) in enumerate(LANES)}
    rows = [
        ("msg", "arrow-t-call", "seq", "reg", "write(CTRL, 'h005)"),
        ("box", "block-t-set", "reg", "set(): desired = 'h005"),
        ("box", "block-t-pre", "reg", "pre_write callbacks"),
        ("msg", "arrow-t-dowrite", "reg", "map", "do_write(rw)"),
        ("box", "block-t-reg2bus", "map", "reg2bus: APB item"),
        ("msg", "arrow-t-start", "map", "drv", "start_item, finish_item"),
        ("msg", "arrow-t-apb", "drv", "dut", "PADDR 'h10, PWDATA 'h005"),
        ("box", "block-t-flops", "dut", "CTRL flops = 'h005"),
        ("par", "arrow-t-done", "drv", "map", "item done",
               "arrow-t-observe", "dut", "pred", "transfer seen"),
        ("box2", "block-t-bus2reg", "map", "bus2reg: IS_OK",
                 "block-t-find", "pred", "bus2reg, find CTRL"),
        ("msg", "arrow-t-predict", "pred", "reg", "predict: mirrored = 'h005"),
        ("msg", "arrow-t-status", "map", "reg", "status"),
        ("box", "block-t-post", "reg", "post_write callbacks"),
        ("msg", "arrow-t-return", "reg", "seq", "status = UVM_IS_OK"),
    ]
    row_h = 46
    top = 112
    h = top + len(rows) * row_h + 40
    s = Svg(w, h, "arr-csrt")
    s.text(w // 2, 34, "One frontdoor write, in time order", 20, INK, 500)
    s.text(w // 2, 58, "csr.write(status, 'h005) with the predictor wired to the monitor", 13, MUTED)
    for k, name in LANES:
        x = xs[k]
        s.rect(x - lane_w // 2, 76, lane_w, 30, "#f0f9ff", BLUE, rx=6)
        s.text(x, 96, name, 14, INK, 500)
        s.out.append(f'<line x1="{x}" y1="106" x2="{x}" y2="{h - 24}" stroke="#cbd5e1" '
                     f'stroke-width="1.2" stroke-dasharray="4,4"/>')

    def msg(id, a, b, label, y):
        x1, x2 = xs[a], xs[b]
        d = 1 if x2 > x1 else -1
        s.link(id, f"M{x1 + d * 6},{y} H{x2 - d * 8}", label, (x1 + x2) // 2, y - 7)

    def note(id, lane, label, y):
        bw = 220
        s.block(id, xs[lane] - bw // 2, y - 15, bw, 30, label, kind="comp" if lane in ("map", "pred") else
                ("hw" if lane == "dut" else "tb"))

    for i, r in enumerate(rows):
        y = top + i * row_h + 20
        if r[0] == "msg":
            msg(r[1], r[2], r[3], r[4], y)
        elif r[0] == "box":
            note(r[1], r[2], r[3], y)
        elif r[0] == "par":
            msg(r[1], r[2], r[3], r[4], y - 6)
            msg(r[5], r[6], r[7], r[8], y + 10)
        elif r[0] == "box2":
            note(r[1], r[2], r[3], y)
            note(r[4], r[5], r[6], y)
    s.write(REPO / "static/images/csr/flow-write-timing.svg")
    return s


# ------------------------------------------------------------------ dark palette
def dark_of(hexc):
    """The colour chipdv's dark-mode filter, invert(0.92) hue-rotate(180deg),
    turns hexc into, so an inlined diagram matches an <img> one."""
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
    r, g, b = (0.92 - 0.84 * c for c in (r, g, b))
    out = (-0.574 * r + 1.430 * g + 0.144 * b,
           0.426 * r + 0.430 * g + 0.144 * b,
           0.426 * r + 1.430 * g - 0.856 * b)
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02x}" for c in out)


def dark_css(svgs):
    colours = set()
    for s in svgs:
        for line in s.out + s.links:
            colours.update(re.findall(r'(?:fill|stroke|color)="(#[0-9a-fA-F]{6})"', line))
    colours.update((BLUE, MUTED))  # marker heads live in <defs>
    rules = ["/* Generated by svg/build/csr_flows.py -- do not edit by hand. */"]
    for c in sorted(colours):
        d = dark_of(c)
        for attr in ("fill", "stroke", "color"):
            rules.append(f'.dark .dv-themed-svg [{attr}="{c}" i] {{ {attr}: {d}; }}')
    (REPO / "assets/css/flow-svg-dark.css").write_text("\n".join(rules) + "\n")


if __name__ == "__main__":
    dark_css([access_view(), timing_view()])
