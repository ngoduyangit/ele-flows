"""Build spec 'jemmia-yellow-emerald' – ~32 s 9:16 TVC "Giữ nắng" for the real yellow emerald-cut ring (muse-tvc skill).
Creative pack: docs/tvc/jemmia-yellow-emerald-tvc.md. P00 = 4-view sheet tiled from the client's product renders."""
import json, pathlib

# Replace SHEET with your own product sheet: POST /api/upload, then paste the returned /api/media/... url
SHEET = "/api/media/1f59cca3-2387-428d-b698-0f45e3ecf65f.jpg"  # 2x2: two 3/4 views, top view, side view

RING = ("the ring in @p00: one rectangular emerald-cut fancy yellow (canary yellow) gemstone with step-cut facets and clipped corners, held "
        "by four slim white-gold prongs with ROUND ball-shaped tips (smooth domed beads on top, like small pearls of metal) in a tall open basket setting; a thin polished white-gold band; one single row of tiny round "
        "white diamonds micro-pavé set along the top of BOTH shoulders, about seven on each side, only on the upper half of the band")
LOCK = ("PRODUCT LOCK: the ring is exactly the ring in @p00 – same emerald-cut yellow stone (rectangular, step facets, NOT round, NOT "
        "oval), same four prongs with round ball tips (never pointed, sharp, tapered or claw-shaped tips), same row of small white pavé diamonds on both shoulders, same thin white-gold band. Do not add a halo, "
        "do not change the stone colour, cut or size, no extra stones. TRUE SIZE: the centre stone measures 7.3 x 5.2 mm (about 1 "
        "carat) – on a hand only about half the finger's width and shorter than the fingernail; never an oversized stone.")
LIGHT = ("Lighting: a dark studio; ONE narrow beam of warm early-morning sunlight (about 3500K) slants in low from the left, with a few "
         "dust motes floating in it; the yellow stone glows from within like a small sun, the white-gold metal and pavé diamonds flash "
         "silver-white. About 75% of the frame falls into charcoal-black shadow.")
STYLE = ("Style: luxury jewellery commercial, real macro product photography, true-to-life gemstone refraction and metal reflections, "
         "crisp detail on the facets, fine film grain, palette of charcoal black, canary yellow and silver-white. Vertical 9:16.")
NO_TEXT = "No text, no letters, no logo, no watermark, no brand marks anywhere."
HAND = ("a young East Asian woman's delicate, graceful hand – slim tapered fingers, narrow wrist, fine small bones, elegant "
        "and feminine; fair, bright light-ivory skin (a shade lighter than average, soft warm-pink undertone); natural but refined "
        "skin texture – only very fine pores and faint soft creases at the knuckles visible up close, a gentle healthy sheen; NO "
        "prominent veins, NO deep wrinkles, NO rough or dry skin; even tone with no freckles, no brown spots, no moles; real "
        "photographed skin, NOT airbrushed plastic, NOT waxy, NOT CGI; short almond nails with sheer nude-pink polish, no other "
        "jewellery")

nodes = [{"key": "p00", "kind": "image", "label": "P00 – Ring photos (4 views)", "url": SHEET}]

# (code, still prompt, subject, action, scene, camera, usable)
SHOTS = [
    ("01 – Sun hits the facets",
     f"Extreme macro of the yellow emerald-cut stone of {RING}; the stepped rectangular facets fill 60% of the frame, two prongs sharp, "
     "the rest of the ring soft; the stone just touched by the first thin edge of the sunbeam, everything else in darkness.",
     "The emerald-cut yellow stone of the ring in extreme macro.",
     "The thin sunbeam slowly slides across the stone from left to right; the stepped facets light up one terrace after another like a "
     "hall of golden mirrors, then the whole stone glows warm yellow.",
     "Black obsidian surface, darkness behind.", "100mm macro, very slow push-in, shallow depth of field, no cuts.", "2-6 s"),
    ("02 – Pavé shoulder",
     f"Extreme macro along one shoulder of {RING}: the row of tiny round white pavé diamonds runs diagonally across the frame toward the "
     "out-of-focus yellow stone, the polished band edge catching a silver line of light.",
     "The row of small white pavé diamonds on the ring's shoulder.",
     "The sunbeam travels along the band; each tiny diamond flashes white one after another toward the yellow stone, which glows at the end.",
     "Darkness, black obsidian below.", "100mm macro, slow slider move along the band toward the centre stone, no cuts.", "2-5.5 s"),
    ("03 – 45° turn",
     f"{RING}, standing upright on a small black obsidian plinth, seen from a 45-degree three-quarter angle slightly from above, ring "
     "occupying 45% of the frame, the yellow stone glowing in the sunbeam, deep black space above.",
     "The yellow emerald-cut ring standing on the obsidian plinth.",
     "The plinth turns the ring slowly through about 60 degrees; light travels over the pavé shoulders and the stone flares yellow once.",
     "Dark studio, the plinth edge catching a thin rim of sunlight.", "85mm, slow orbit opposite to the rotation, steady, no cuts.", "1.5-5.5 s"),
    ("04 – Top-down bloom",
     f"Top-down view straight onto {RING}, lying flat on black satin: the rectangular yellow stone in the centre with its four prongs, "
     "the pavé rows running left and right along the band, exactly like the top view in the reference.",
     "The ring seen from directly above.",
     "The sunbeam widens slowly over the ring; the stone blooms from dark amber to bright canary yellow, pavé diamonds twinkle.",
     "Black satin with soft folds.", "50mm, slow vertical descent toward the stone, top-down, no cuts.", "2-5.5 s"),
    ("05 – On her hand",
     f"Close-up of {HAND}, resting palm-down on black satin inside the sunbeam, fingers relaxed and slightly spread, wearing {RING} "
     "on the ring finger – already fully on, at the base of the finger, the yellow stone upright on top. Only this one hand, no other "
     "hand, no face.",
     f"The woman's hand wearing the ring: {HAND}. The ring is already on her finger and stays there.",
     "Her fingers relax and glide a little across the satin; the yellow stone catches the sun and glows.",
     "Black satin, darkness around, only the hand in the sunbeam.", "65mm, slow lateral slider from left to right, focus on the ring, no cuts.",
     "1.5-6.5 s"),
    ("06 – Hero hand",
     f"Hero close-up of {HAND}, wearing {RING} on the ring finger, back of the hand toward camera, fingers together, seen from the front "
     "slightly above; the yellow stone centred and glowing in the sunbeam.",
     f"The woman's hand wearing the ring: {HAND}.",
     "She turns her wrist a few degrees into the light; the yellow stone bursts into a warm golden flare and the pavé flashes white, "
     "then the hand holds still.",
     "Pure black background.", "85mm, slow pull-back revealing the whole hand, no cuts.", "2-6 s"),
    ("07 – Morning window",
     f"{HAND}, wearing {RING}, resting on a dark wooden window sill; soft early-morning sun streams through a sheer linen curtain behind, "
     "dust motes glowing in the light, the yellow stone lit like a small sun, background a warm blur. Only the hand, no face.",
     f"The woman's hand wearing the ring on the window sill: {HAND}.",
     "The curtain breathes gently in a breeze; sunlight flickers across the hand and the stone sparkles; her fingers relax slightly.",
     "Dark wooden window sill, sheer linen curtain, warm morning haze.",
     "65mm, gentle push-in toward the ring with a soft natural lens flare, no cuts.", "1.5-6 s"),
    ("08 – Endcard",
     f"{RING}, lying on a black velvet cushion, centred in the lower third of the vertical frame, stone facing camera, glowing warm "
     "yellow in a small pool of sunlight; the upper two-thirds of the frame is clean empty darkness reserved for a logo.",
     "The ring lying on black velvet.",
     "Almost still; one soft golden glint rises in the stone and fades, dust motes drift through the light.",
     "Black velvet, empty dark space above.", "85mm, locked-off tripod, the camera does NOT move or zoom at all.", "1-4.5 s"),
]

for i, (code, sprompt, *_ ) in enumerate(SHOTS, 1):
    nodes.append({"key": f"a{i:02}", "kind": "image-generation", "label": f"A{code}", "aspectRatio": "9:16", "refs": ["p00"],
                  "prompt": f"{sprompt}\n{LOCK}\n{LIGHT}\n{STYLE}\n{NO_TEXT}"})
for i, (code, _s, subject, action, scene, camera, usable) in enumerate(SHOTS, 1):
    prompt = "\n".join([
        f"Subject: {subject} Keep the ring exactly as in the reference image – rectangular emerald-cut yellow stone, four round ball-tipped prongs (never pointed), small "
        "white pavé diamonds on both shoulders, thin white-gold band.",
        f"Action: {action}",
        f"Scene: {scene}",
        f"Camera: {camera}",
        LIGHT.replace("@p00", "the reference"),
        STYLE,
        "Timing: hold the opening composition for the first 1.5 seconds, do the action, then hold the final composition until the end.",
        f"HARD RULES: one continuous shot, no cuts, no faces, no extra hands, the ring design and stone colour never change, the ring "
        f"never falls over. {NO_TEXT} No subtitles. No speech, no voice.",
    ])
    nodes.append({"key": f"v{i:02}", "kind": "video-generation", "label": f"V{code} (use {usable})", "duration": 10,
                  "aspectRatio": "9:16", "generateAudio": False, "refs": [f"a{i:02}"], "prompt": prompt})

spec = {"id": "jemmia-yellow-emerald", "name": "Jemmia – Giữ nắng (nhẫn emerald vàng)",
        "description": "~32 s 9:16 TVC, creative pack docs/tvc/jemmia-yellow-emerald-tvc.md",
        "defaults": {"imageModel": "muse", "videoModel": "muse", "aspectRatio": "9:16"},
        "nodes": nodes}
out = pathlib.Path(__file__).with_suffix("").with_suffix(".spec.json")
out.write_text(json.dumps(spec, ensure_ascii=False, indent=1))
print(out, len(nodes), "nodes", max(len(n.get("prompt", "")) for n in nodes), "max prompt chars")
