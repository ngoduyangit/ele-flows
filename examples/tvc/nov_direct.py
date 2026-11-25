"""Run Nov models (Seedream stills / Seedance videos) for nodes of a flow WITHOUT relying on the node's saved model/prompt.
Why: an open editor tab autosaves its stale copy over the flow file, reverting model/prompt edits made on disk. Here every
request is sent to POST /api/run with `track`, so the server writes the result into the node as a generation (kept by the
editor like any API result) – whatever the node's own settings are.

usage: python3 examples/nov_direct.py <jobs.json>
jobs.json: [{"flow": id, "key": specKey, "req": {RunRequest fields}}, ...]  – up to 4 run in parallel."""
import json, sys, uuid, urllib.request, concurrent.futures as cf

BASE = "http://localhost:5180"

def node_id(flow, key):
    d = json.load(urllib.request.urlopen(f"{BASE}/api/flows/{flow}"))
    d = d.get("flow", d)
    return next(n["id"] for n in d["nodes"] if n["data"].get("specKey") == key)

def one(job):
    track = {"flowId": job["flow"], "nodeId": node_id(job["flow"], job["key"]), "genId": uuid.uuid4().hex[:20]}
    body = json.dumps({**job["req"], "track": track}).encode()
    r = urllib.request.Request(f"{BASE}/api/run", data=body, headers={"Content-Type": "application/json"})
    try:
        out = json.load(urllib.request.urlopen(r, timeout=1800))
        return job["key"], "done", out.get("url"), out.get("cost")
    except urllib.error.HTTPError as e:
        return job["key"], "error", None, e.read().decode()[:300]
    except Exception as e:
        return job["key"], "error", None, str(e)[:300]

jobs = json.load(open(sys.argv[1]))
with cf.ThreadPoolExecutor(4) as ex:
    for res in ex.map(one, jobs):
        print(*res, flush=True)
