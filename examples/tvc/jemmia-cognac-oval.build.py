"""Build spec 'jemmia-cognac-oval' – ~44 s 9:16 TVC "Chạng vạng" for the real oval cognac ring (muse-tvc skill).
Creative pack: docs/tvc/jemmia-cognac-oval-tvc.md. P00 = 4-view sheet tiled from the client's product renders.
Lessons kept from earlier TVCs: no putting-the-ring-on shots; prong tips are locked as ROUND in words."""
import json, pathlib

# Replace SHEET with your own product sheet: POST /api/upload, then paste the returned /api/media/... url
SHEET = "/api/media/7762bffa-0e81-41bf-ba52-359faa1c32cc.jpg"  # 2x2: two 3/4 views, top view, side view

RING = ("the ring in @p00: one oval-cut cognac-coloured gemstone (warm amber-brown) held lengthwise by four slim white-gold prongs "
        "with ROUND ball-shaped tips in a raised open setting; a thin plain polished white-gold band; on EACH shoulder next to the centre "
        "stone, a small scattered cluster of five tiny round white diamonds of two or three slightly different sizes, staggered like a "
        "little constellation, each in its own tiny prongs; the rest of the band is plain")
LOCK = ("PRODUCT LOCK: the ring is exactly the ring in @p00 – same oval cognac stone (oval, NOT round, NOT emerald-cut, warm amber-brown, "
        "NOT yellow, NOT red), same four prongs with round ball tips (never pointed or claw-shaped), same two scattered five-stone "
        "diamond clusters on the shoulders (not a straight pavé row, not a halo), same thin plain white-gold band. TRUE SCALE: the oval stone is small and delicate – its length is only about one "
        "quarter of the ring's outer diameter, exactly the proportions of the reference; never an oversized stone. No extra stones.")
STYLE = ("Style: luxury jewellery commercial, real macro product photography, true-to-life gemstone refraction and metal reflections, "
         "crisp facets, fine film grain, palette of dusk indigo, cognac amber and star-white. Vertical 9:16.")
NO_TEXT = "No text, no letters, no logo, no watermark, no brand marks anywhere."
HAND = ("a young Vietnamese woman's slender hand with natural light-tan skin, real skin texture with fine knuckle lines, short almond "
        "nails with sheer nude polish, no other jewellery")
WARM = ("Lighting: golden-hour dusk – a very low warm sunset light (about 3000K) skims in from the right and shines through the oval "
        "stone so it burns deep amber like a setting sun; soft cool blue-indigo skylight from above fills the shadows; deep indigo-black "
        "background.")
COOL = ("Lighting: late dusk turning to blue hour – the sunset is only a thin warm amber rim from the right, the rest is cool "
        "indigo-blue skylight; the oval stone still holds a warm amber glow while the tiny side diamonds twinkle star-white like the first "
        "stars; deep indigo background.")

nodes = [{"key": "p00", "kind": "image", "label": "P00 – Ring photos (4 views)", "url": SHEET}]

# (code, light, still prompt, subject, action, scene, camera, usable)
SHOTS = [
    ("01 – Sunset in the stone", WARM,
     f"Extreme macro of the oval cognac stone of {RING}; the stone fills 55% of the frame with two round-tipped prongs sharp, the "
     "shoulder clusters soft at the edges; the stone half in shadow, its right edge catching the low sunset light.",
     "The oval cognac stone of the ring in extreme macro.",
     "A low band of sunset light slowly slides across the stone from right to left; the facets light up one by one and the whole stone "
     "glows deep amber like a setting sun.", "Black polished stone surface, indigo darkness behind.",
     "100mm macro, very slow push-in, shallow depth of field, no cuts.", "2-6 s"),
    ("02 – First stars", WARM,
     f"Extreme macro of one shoulder of {RING}: the scattered cluster of five tiny round diamonds, each in its own tiny prongs, sharp in "
     "the foreground, the oval cognac stone glowing out of focus behind them.",
     "The small scattered diamond cluster on the ring's shoulder.",
     "The tiny diamonds twinkle one after another with star-like white glints, while the cognac stone glows softly behind them.",
     "Indigo darkness, black stone below.", "100mm macro, slow lateral slider move along the shoulder toward the stone, no cuts.", "2-6 s"),
    ("03 – 45° against the sunset", WARM,
     f"{RING}, standing upright on a small polished black stone plinth, seen from a 45-degree three-quarter angle, ring occupying 45% "
     "of the frame, backlit by the low sunset so the band has a warm rim and the stone glows amber; indigo space above.",
     "The oval cognac ring standing on the black stone plinth.",
     "The plinth turns the ring slowly through about 50 degrees; the sunset rim light travels along the band and the stone flares "
     "amber once. The ring stays upright and the plinth never changes shape.",
     "Dusk studio, warm rim of light on the plinth edge.", "85mm, slow orbit opposite to the rotation, steady, no cuts.", "1-5 s"),
    ("04 – Constellation top-down", COOL,
     f"Top-down view straight onto {RING}, lying flat on dark indigo silk: the oval cognac stone in the centre with its four round-tipped "
     "prongs, the two scattered five-diamond clusters to the left and right, exactly like the top view in the reference.",
     "The ring seen from directly above.",
     "The light slowly shifts from warm amber to cool blue; the stone keeps its amber glow while the side diamonds start to twinkle like "
     "stars.", "Dark indigo silk with soft folds.", "50mm, slow vertical descent toward the stone, top-down, no cuts.", "2-6 s"),
    ("05 – On the sill at sunset", WARM,
     f"{RING}, lying on its side on a dark walnut window sill, the open window behind showing a soft out-of-focus sunset sky in amber "
     "and dusty pink, the ring standing upright on the sill in a three-quarter view; a long warm shadow of the ring stretches across the wood.",
     "The ring lying on the walnut window sill.",
     "Very still; the long shadow slowly stretches as the sun sinks, the stone glows amber and a few tiny glints run across the side "
     "diamonds.", "Walnut window sill, sunset sky softly blurred outside.",
     "65mm, slow push-in along the sill toward the ring, no cuts.", "2-6 s"),
    ("06 – On her hand", WARM,
     f"Close-up of {HAND}, wearing {RING} on the ring finger (already fully on, at the base of the finger, stone on top), resting "
     "relaxed on cream linen in the warm sunset light. Only the hand, no face.",
     f"The woman's hand wearing the ring: {HAND}. The ring is already on her finger and stays there.",
     "Her fingers relax and slide a little across the linen; the stone catches the sunset and glows amber; the side diamonds glint.",
     "Cream linen, warm dusk light.", "65mm, slow lateral slider from left to right, focus on the ring, no cuts.", "1.5-6 s"),
    ("07 – Hero turn", WARM,
     f"Hero close-up of {HAND}, wearing {RING} on the ring finger, back of the hand toward camera, fingers gracefully together, seen "
     "from the front slightly above; the oval cognac stone centred and glowing, indigo background.",
     f"The woman's hand wearing the ring: {HAND}.",
     "She turns her wrist a few degrees toward the sunset light; the stone flares deep amber and the side diamonds sparkle, then the "
     "hand holds still. Fingers never cover the ring.", "Deep indigo background.",
     "85mm, slow pull-back revealing the whole hand, no cuts.", "1.5-5.5 s"),
    ("08 – His hand", COOL,
     f"Close-up of two hands: {HAND}, wearing {RING}, resting palm-down on top of a young man's open palm (his hand: slightly larger, "
     "warm tan skin, short clean nails, the cuff of a dark navy shirt). Only hands, no faces. The ring is clearly visible on top.",
     "Two hands: the woman's hand wearing the ring resting in the man's open palm.",
     "His thumb slowly and gently strokes the back of her hand once, below the ring, never touching or covering the ring; her fingers "
     "curl softly around his. The stone glows amber.", "Soft indigo dusk background, cream linen below.",
     "85mm, very slow push-in, focus on the ring, no cuts.", "1.5-6 s"),
    ("09 – Window at dusk", COOL,
     f"{HAND}, wearing {RING}, fingertips resting lightly against a window glass; outside, a blurred dusk sky with the last amber band "
     "of sunset on the horizon under deep blue; the oval stone glows amber like a tiny sun against the glass. Only the hand.",
     f"The woman's hand wearing the ring against the window: {HAND}.",
     "Her fingertips stay on the glass; the last sunset light fades a little while the stone keeps glowing and the side diamonds twinkle.",
     "Window glass, dusk sky outside.", "65mm, gentle push-in with a soft natural lens flare from the horizon, no cuts.", "1.5-5.5 s"),
    ("10 – Stars on the hand", COOL,
     f"Macro close-up of {HAND}'s ring finger wearing {RING}: the scattered side diamonds and the oval cognac stone fill the frame, the "
     "skin softly out of focus, cool blue-hour light.",
     "Macro of the ring on the woman's finger.",
     "The hand stays still; the tiny side diamonds twinkle one by one like stars appearing, the cognac stone holds a calm amber glow.",
     "Blue-hour light, soft skin bokeh.", "100mm macro, slow slider move across the ring, no cuts.", "2-5.5 s"),
    ("11 – Endcard", COOL,
     f"{RING}, lying on a midnight-blue velvet cushion, centred in the lower third of the vertical frame, stone facing camera and glowing "
     "amber; the upper two-thirds of the frame is clean empty deep-indigo space reserved for a logo.",
     "The ring lying on midnight-blue velvet.",
     "Almost still; the side diamonds twinkle once like stars and the stone glows; nothing else moves.",
     "Midnight-blue velvet, empty indigo space above.", "85mm, locked-off tripod, the camera does NOT move or zoom at all.", "1-4.5 s"),
]

for i, (code, light, sprompt, *_ ) in enumerate(SHOTS, 1):
    nodes.append({"key": f"a{i:02}", "kind": "image-generation", "label": f"A{code}", "aspectRatio": "9:16", "refs": ["p00"],
                  "prompt": f"{sprompt}\n{LOCK}\n{light}\n{STYLE}\n{NO_TEXT}"})
for i, (code, light, _s, subject, action, scene, camera, usable) in enumerate(SHOTS, 1):
    prompt = "\n".join([
        f"Subject: {subject} Keep the ring exactly as in the reference image – oval cognac stone, four prongs with round ball tips, two "
        "small scattered five-diamond clusters on the shoulders, thin plain white-gold band.",
        f"Action: {action}",
        f"Scene: {scene}",
        f"Camera: {camera}",
        light,
        STYLE,
        "Timing: hold the opening composition for the first 1.5 seconds, do the action, then hold the final composition until the end.",
        f"HARD RULES: one continuous shot, no cuts, no faces, no extra hands, the ring design and stone colour never change, prongs stay "
        f"round-tipped, the ring never falls, never moves on or off the finger, never passes through skin. {NO_TEXT} No subtitles. "
        "No speech, no voice.",
    ])
    nodes.append({"key": f"v{i:02}", "kind": "video-generation", "label": f"V{code} (use {usable})", "duration": 10,
                  "aspectRatio": "9:16", "generateAudio": False, "refs": [f"a{i:02}"], "prompt": prompt})

spec = {"id": "jemmia-cognac-oval", "name": "Jemmia – Chạng vạng (nhẫn oval cognac)",
        "description": "~44 s 9:16 TVC, creative pack docs/tvc/jemmia-cognac-oval-tvc.md",
        "defaults": {"imageModel": "muse", "videoModel": "muse", "aspectRatio": "9:16"},
        "nodes": nodes}
out = pathlib.Path(__file__).with_suffix("").with_suffix(".spec.json")
out.write_text(json.dumps(spec, ensure_ascii=False, indent=1))
print(out, len(nodes), "nodes", max(len(n.get("prompt", "")) for n in nodes), "max prompt chars")
