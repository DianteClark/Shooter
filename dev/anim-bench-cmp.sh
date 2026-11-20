#!/bin/sh
# Characters CPU before/after (docs/ANIMATION.md "Performance"): alternates a base checkout and this one, ROUNDS rounds
# each, and prints every round's trimmed mean (ms a frame of Characters.update). The machine is shared: compare the
# medians of the rounds.
#   dev/anim-bench-cmp.sh /tmp/anim-base [n=12] [rounds=5] [frames=3000]
#   (a base: mkdir /tmp/anim-base && git archive <commit> js vendor | tar -x -C /tmp/anim-base)
BASE=$1; N=${2:-12}; ROUNDS=${3:-5}; FRAMES=${4:-3000}
HERE=$(cd "$(dirname "$0")/.." && pwd)
for i in $(seq 1 "$ROUNDS"); do
  for R in "$BASE" "$HERE"; do
    ROOT=$R node --import "$HERE/dev/anim-bench-hooks.mjs" "$HERE/dev/anim-bench-node.mjs" "$N" "$FRAMES" 2>/dev/null | tail -1
  done
done | python3 -c "
import json, sys, statistics as st
rows = [json.loads(l) for l in sys.stdin if l.startswith('{')]
by = {}
for r in rows: by.setdefault(r['root'], []).append(r['trimmed'])
for k, v in by.items(): print(f'{k}: median {st.median(v):.4f} ms  rounds {[round(x, 4) for x in v]}')
ks = list(by)
if len(ks) == 2: print(f'change {100 * (st.median(by[ks[1]]) / st.median(by[ks[0]]) - 1):+.1f}%  (n=$N)')
"
