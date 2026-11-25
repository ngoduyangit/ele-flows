"""Switch stills A01–A08 of flow 'jemmia-yellow-emerald' to Seedream 5.5 (Nov, 2K) with the current prompts of the build script.
Writes the flow file directly (keeps generation history – /run "inputs" would wipe it). Leave the editor tab off this flow."""
import importlib.util, json, pathlib, re, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ye", ROOT / "examples/tvc/jemmia-yellow-emerald.build.py")
ye = importlib.util.module_from_spec(spec); spec.loader.exec_module(ye)
FLOW = ROOT / ".flows/flows/jemmia-yellow-emerald.json"
specs = {n["key"]: n for n in json.loads((ROOT / "examples/tvc/jemmia-yellow-emerald.spec.json").read_text())["nodes"]}

d = json.loads(FLOW.read_text())
by_key = {n["data"].get("specKey"): n for n in d["nodes"]}
p00 = by_key["p00"]
chip = {"type": "prompt-tag", "attrs": {"id": f"node:{p00['id']}", "type": "node-reference", "label": p00["data"]["label"]}}

def doc(text):
    paras = []
    for line in text.split("\n"):
        parts = re.split(r"(@p00)", line)
        content = [chip if x == "@p00" else {"type": "text", "text": x} for x in parts if x]
        paras.append({"type": "paragraph", "content": content} if content else {"type": "paragraph"})
    return {"type": "doc", "content": paras}

for i in range(1, 9):
    n = by_key[f"a{i:02}"]
    p = n["data"]["parameters"]
    p["image"] = {**p["image"], "modelId": "nov/seedream-5.5"}
    p["resolution"] = "2K"
    # Seedream: say plainly that reference image 1 is the real product (4 views)
    text = specs[f"a{i:02}"]["prompt"] + ("\nThe ring must match the real product photos in @p00 exactly (four views of the same ring) – "
                                          "photorealistic, not a 3D render.")
    p["prompt"] = doc(text)
    n["data"]["label"] = re.sub(r"( · Seedream)?$", " · Seedream", n["data"]["label"], count=1)
d["updatedAt"] = int(time.time() * 1000)
FLOW.write_text(json.dumps(d, ensure_ascii=False))
print("switched", [f"a{i:02}" for i in range(1, 9)])
