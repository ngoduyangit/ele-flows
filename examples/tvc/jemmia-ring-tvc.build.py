"""Build spec 'jemmia-ring-tvc' – 20 s 9:16 studio TVC for a diamond solitaire ring (trial of the muse-tvc skill).
Creative pack: docs/tvc/jemmia-ring-tvc.md. Row 1 = product lock sheet, row 2 = shot stills, row 3 = videos, then music + final."""
import json, pathlib

RING = ("a classic diamond solitaire engagement ring: one round brilliant-cut diamond (about 1 carat) held by six slim claw prongs "
        "in a raised cathedral setting, on a thin polished 18k white-gold band of uniform 2 mm width, no side stones, no engraving")
LOCK = ("PRODUCT LOCK: the ring is exactly the ring in @p01 – same round brilliant diamond, same six prongs, same thin white-gold band; "
        "do not add stones, halos, patterns or change the metal colour.")
LIGHT = ("Lighting: a pitch-dark studio lit by ONE hard narrow 5600K spotlight from upper-left at 45 degrees that makes the diamond "
         "facets flash and throw tiny rainbow dispersion sparks; a very faint warm 3200K bounce from low right only kisses the metal edge "
         "and skin. About 80% of the frame falls into charcoal-black (#0B0B0E) shadow.")
STYLE = ("Style: luxury jewellery commercial, real macro product photography, true-to-life metal reflections and real diamond "
         "refraction, crisp detail on the stone, fine film grain, restrained palette of charcoal black, ivory-white light and a touch "
         "of champagne gold. Vertical 9:16.")
NO_TEXT = "No text, no letters, no logo, no watermark, no brand marks anywhere."
HAND = ("a young Vietnamese woman's slender hand with natural light-tan skin, real skin texture with fine lines on the knuckles, "
        "short almond nails with sheer nude polish, no other jewellery")

nodes = [
    {"key": "p01", "kind": "image-generation", "label": "P01 – Ring product lock", "aspectRatio": "1:1",
     "prompt": (f"Product reference sheet of {RING}. Three views side by side on a seamless matte charcoal background: front view "
                "(table of the diamond facing camera), three-quarter side view showing the cathedral shoulders and prongs, and top-down "
                "view. Even soft studio light so the design is fully readable, sharp focus, true white-gold colour. " + NO_TEXT)},
]

# (still key, video key, label code, still prompt, video 6-segment parts, usable window)
SHOTS = [
    ("a01", "v01", "01 – Macro facets",
     f"Extreme macro of the diamond of the ring from @p01, filling 60% of the frame, the crown facets and table razor-sharp, the prongs "
     "and a sliver of the band soft at the edge of focus, resting on black polished obsidian with a faint reflection.",
     dict(subject="The round brilliant diamond of the ring in the still, in extreme macro.",
          action="A thin blade of light slowly sweeps from left to right across the crown; each facet flashes white in turn and throws "
                 "tiny rainbow sparks, then the stone settles into a steady glow.",
          scene="Black polished obsidian surface, pure darkness behind.",
          camera="100mm macro, very slow continuous push-in toward the table of the stone, shallow depth of field, no cuts.",
          usable="2.5-6.5 s")),
    ("a02", "v02", "02 – 45° showcase",
     "The ring from @p01 standing upright on a small black obsidian plinth, seen from a 45-degree three-quarter angle slightly from "
     "above, ring occupying 45% of the frame, the diamond catching the light, deep black negative space above.",
     dict(subject="The diamond solitaire ring standing on the obsidian plinth.",
          action="The plinth turns the ring slowly and smoothly through about 60 degrees; light travels along the white-gold band and "
                 "the diamond flashes once when it faces the light.",
          scene="Pitch-dark studio, the plinth's top edge catching a thin rim of light.",
          camera="85mm, slow orbit around the ring in the opposite direction to its rotation, gentle and steady, no cuts.",
          usable="2-6 s")),
    ("a03", "v03", "03 – Putting it on",
     f"Close-up of {HAND}, fingers relaxed and slightly spread over black satin fabric, the ring from @p01 held between the thumb and "
     "index finger of her other hand just at the tip of the ring finger, about to slide on. Only hands visible, no face, three-quarter "
     "angle.",
     dict(subject=f"Two hands of the same woman: {HAND}; the ring from the still.",
          action="She slowly slides the ring down onto her ring finger until it sits at the base, then lets the hand rest flat on the "
                 "satin; the diamond catches the spotlight and sparkles.",
          scene="Black satin fabric with soft folds, darkness all around, only the hands are lit.",
          camera="65mm, slow lateral slider move from left to right, shallow depth of field, focus stays on the ring, no cuts.",
          usable="1.5-6.5 s")),
    ("a04", "v04", "04 – Hero hand",
     f"Hero close-up of {HAND}, wearing the ring from @p01 on the ring finger, back of the hand toward camera, fingers gracefully "
     "together, seen from the front and slightly above; the ring fills the centre of the frame, the diamond blazing in the spotlight.",
     dict(subject=f"The woman's hand wearing the solitaire ring: {HAND}.",
          action="She turns her wrist a few degrees toward the light, unhurried; the diamond bursts into a bright star-like sparkle "
                 "with rainbow flecks, then the hand holds still.",
          scene="Pure black background, black satin barely visible below.",
          camera="85mm, slow pull-back from the ring revealing the whole hand, steady, no cuts.",
          usable="2-5.5 s")),
    ("a05", "v05", "05 – Endcard",
     "The ring from @p01 lying on a black velvet cushion, centred in the lower third of the vertical frame, the diamond facing camera; "
     "the upper two-thirds of the frame is clean empty darkness reserved for a logo.",
     dict(subject="The solitaire ring lying on black velvet.",
          action="Almost still; one single soft sparkle rises in the diamond and fades, the velvet fibres glint.",
          scene="Black velvet, empty dark space above.",
          camera="85mm, locked-off with an almost imperceptible push-in, no cuts.",
          usable="1.5-5 s")),
]

for still, vid, code, sprompt, v in SHOTS:
    nodes.append({"key": still, "kind": "image-generation", "label": f"A{code}", "aspectRatio": "9:16", "refs": ["p01"],
                  "prompt": f"{sprompt}\n{LOCK}\n{LIGHT}\n{STYLE}\n{NO_TEXT}"})
for still, vid, code, sprompt, v in SHOTS:
    prompt = "\n".join([
        f"Subject: {v['subject']} Keep the ring exactly as in the reference image – same diamond, prongs and thin white-gold band.",
        f"Action: {v['action']}",
        f"Scene: {v['scene']}",
        f"Camera: {v['camera']}",
        LIGHT,
        STYLE,
        "Timing: hold the opening composition for the first 1.5 seconds, do the action, then hold the final composition until the end.",
        f"HARD RULES: one continuous shot, no cuts, no people's faces, no extra hands, the ring design never changes. {NO_TEXT} "
        "No subtitles. No speech, no voice.",
    ])
    nodes.append({"key": vid, "kind": "video-generation", "label": f"V{code} (use {v['usable']})", "duration": 10,
                  "aspectRatio": "9:16", "generateAudio": False, "refs": [still], "prompt": prompt})

nodes.append({"key": "score", "kind": "music", "label": "Score 20 s",
              "prompt": ("Minimal luxury jewellery commercial score, 20 seconds, 70 BPM: sparse felt piano notes over a warm low pad, "
                         "a delicate glass shimmer chime at 2 s and at 13 s, gentle swell from 10 s, ends on one long resolved major chord "
                         "ringing out over the last 4 seconds. Instrumental, no vocals.")})

spec = {"id": "jemmia-ring-tvc", "name": "Jemmia – Một tia sáng (TVC thử muse-tvc)",
        "description": "20 s 9:16 studio TVC, creative pack docs/tvc/jemmia-ring-tvc.md",
        "defaults": {"imageModel": "muse", "videoModel": "muse", "aspectRatio": "9:16"},
        "nodes": nodes}
out = pathlib.Path(__file__).with_suffix("").with_suffix(".spec.json")
out.write_text(json.dumps(spec, ensure_ascii=False, indent=1))
print(out, len(nodes), "nodes", max(len(n.get("prompt", "")) for n in nodes), "max prompt chars")
