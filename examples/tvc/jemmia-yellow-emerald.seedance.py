"""Add Seedance 2.5 (Nov, 720p) takes S01–S08 to flow 'jemmia-yellow-emerald'.
Inputs per node: reference image 1 = P00 (2x2 sheet of the client's real product renders) + the approved still A0n as start frame.
With a reference present, Nov sends both as @Image refs (reference mode): @Image1 = product photos, @Image2 = opening frame.
Idempotent: re-running updates the prompts of existing S nodes. Close/leave the editor tab on this flow before running."""
import importlib.util, json, pathlib, uuid, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ye", ROOT / "examples/tvc/jemmia-yellow-emerald.build.py")
ye = importlib.util.module_from_spec(spec); spec.loader.exec_module(ye)  # also rewrites the Muse spec (harmless)

FLOW = ROOT / ".flows/flows/jemmia-yellow-emerald.json"
DUR = {5: 6}  # all 6 s
# Shot 05 for Seedance: the ring is already on – the helping hand only lets go (no putting-on, see user feedback)
ACTION05 = ("The thumb and index finger of her other hand gently let go of the ring and slide out of frame; the ring stays exactly "
            "where it is, around her finger, the yellow stone upright on top; her hand relaxes on the satin and the stone glows.")

# Seedance takes "slow / hold / never change" literally and returns a zoomed still – give every shot a clear camera path,
# moving light and parallax elements, motion through the whole clip (user feedback on S01).
MOTION = {
    1: ("A bright beam of sunlight sweeps across the stone from left to right at a steady pace; facet after facet flashes white and "
        "gold, caustic sparkles dance across the black surface, dust motes drift through the beam in the foreground.",
        "100mm macro, smooth continuous orbit of about 40 degrees around the stone in an arc from left to right while gently pushing "
        "in, strong parallax between the drifting dust in front and the ring; rack focus from the front prongs to the table of the stone."),
    2: ("Light runs along the band like a wave: each small pavé diamond flashes in sequence toward the centre stone, tiny rainbow "
        "glints, dust floats through the beam.",
        "100mm macro on a slider gliding at a moderate pace along the shoulder from the band toward the centre stone, the camera rising "
        "slightly as it travels, rack focus from the pavé row to the yellow stone at the end."),
    3: ("The plinth rotates the ring a full 90 degrees at a steady pace; the yellow stone flares as it faces the beam, highlights "
        "travel over the band and the pavé shoulders.",
        "85mm, continuous orbit in the opposite direction to the rotation, about 30 degrees, slight crane up, clear parallax between "
        "the plinth edge in the foreground and the dark background."),
    4: ("The sunbeam slowly widens and brightens over the ring, the stone blooms from amber to bright canary yellow, glints race "
        "along the two pavé rows, dust drifts across the frame.",
        "50mm, top-down spiral: the camera descends toward the ring while rotating 45 degrees around it, continuous movement."),
    5: ("Her hand turns a little toward the light and her fingers spread and glide gracefully across the satin; the yellow stone "
        "flashes; the satin folds shift softly under her hand. The ring stays at the base of her finger.",
        "65mm, smooth lateral arc from left to right around the hand with a gentle push-in toward the ring, continuous movement."),
    6: ("She slowly turns her wrist about 30 degrees toward the light and back, fingers flowing gracefully and slightly separating; "
        "the stone throws a golden flare at the turn, the pavé sparkles; dust drifts through the beam.",
        "85mm, continuous pull-back with a slight arc to the left, revealing the whole hand and the light beam, steady."),
    7: ("The sheer linen curtain billows clearly in a breeze, sunlight flickers and sweeps across the hand; her fingers glide a few "
        "centimetres along the sill and relax; the stone sparkles; dust motes swirl in the light.",
        "65mm, slow dolly in along the window sill toward the ring with a gentle arc, soft natural lens flare, continuous movement."),
    8: ("A soft band of sunlight sweeps once across the velvet and the ring from left to right; the stone glows and flashes as the "
        "light passes, the pavé twinkles, a few dust motes drift; the ring itself stays in place.",
        "85mm, locked-off tripod, the camera does not move – all the motion comes from the light and the dust."),
}

def doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": line}]} if line else {"type": "paragraph"}
                                       for line in text.split("\n")]}

def prompt(i, shot):
    code, _s, subject, _action, scene, _camera, _usable = shot
    action, camera = MOTION[i]
    return "\n".join([
        "The video opens on the start frame (same composition, same lighting) and continues it as one continuous shot.",
        "PRODUCT: the ring must be exactly the real product shown in reference image 1 (four views of the same ring) – rectangular "
        "emerald-cut canary-yellow stone with step facets, four slim prongs with round ball tips (never pointed), one row of small "
        "white pavé diamonds on the top of both shoulders, thin polished white-gold band. True size: the stone is 7.3 x 5.2 mm – on the hand only about half the "
        "finger's width; never enlarge it. Match its proportions and details exactly.",
        f"Subject: {subject}",
        f"Action: {action}",
        f"Scene: {scene}",
        f"Camera: {camera}",
        ye.LIGHT, ye.STYLE,
        "Motion: movement starts immediately and continues through the whole clip at a steady, natural pace – a real camera move with "
        "parallax, moving light and moving elements; never a static frame, never a simple digital zoom into the image.",
        "HARD RULES: one continuous shot, no cuts, no faces, no extra hands, the ring design and stone colour never change, the ring "
        "never falls over, never moves along or off the finger, never passes through skin. No text, no logo, no watermark. "
        "No speech, no voice, no music.",
    ])

d = json.loads(FLOW.read_text())
by_key = {n["data"].get("specKey"): n for n in d["nodes"]}
for i, shot in enumerate(ye.SHOTS, 1):
    a, v, s = by_key[f"a{i:02}"], by_key[f"v{i:02}"], f"s{i:02}"
    node = by_key.get(s)
    if not node:
        node = json.loads(json.dumps(v))
        node["id"] = uuid.uuid4().hex[:20]
        node["position"] = {"x": v["position"]["x"] + 360, "y": v["position"]["y"]}
        for k in ("generations", "activeGenerationId", "apiUpdatedAt", "measured"):
            node.pop(k, None); node["data"].pop(k, None)
        node["data"]["specKey"] = s
        d["nodes"].append(node)
        d["edges"].append({"id": f"edge-{a['id']}-{node['id']}-startFrame", "source": a["id"], "sourceHandle": "output",
                           "target": node["id"], "targetHandle": "startFrame", "type": "dataflow"})
    p = node["data"]["parameters"]
    node["data"]["label"] = f"S{shot[0]} · Seedance 2.5"
    p["resolution"] = "720p"
    p["referenceImages"] = []
    pid = by_key["p00"]["id"]
    eid = f"edge-{pid}-{node['id']}-referenceImages"
    if not any(e["id"] == eid for e in d["edges"]):
        d["edges"].append({"id": eid, "source": pid, "sourceHandle": "output", "target": node["id"],
                           "targetHandle": "referenceImages", "type": "dataflow"})
    p["video"] = {**p["video"], "modelId": "nov/seedance-2.5", "durationSecs": DUR.get(i, 6), "generateAudio": False}
    p["prompt"] = doc(prompt(i, shot))
d["updatedAt"] = int(time.time() * 1000)
FLOW.write_text(json.dumps(d, ensure_ascii=False))
print("S nodes:", sorted(k for k in (n["data"].get("specKey") for n in d["nodes"]) if k and k.startswith("s")))
