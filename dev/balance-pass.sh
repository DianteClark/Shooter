#!/bin/sh
# Balance pass rig (WEAPONS-OVERHAUL.md "Balance pass 3"): mirrored bot matches over several seeds with stock guns,
# best builds and signature builds, then K/D per gun summed over the seeds (dev/kd-combine.mjs).
#
#   sh dev/balance-pass.sh                 all three configs, seeds 1-6, 2 rounds each; tables in dev/out/pass/
#   SEEDS="1 2 3 4" ROUNDS=2 sh dev/balance-pass.sh stock      one config (stock | best | sig | sigonly)
#   OUT=dev/out/pass-before sh dev/balance-pass.sh             keep a "before" set for --vs comparisons
#
# Rebuild the inputs first when attachments change:
#   node dev/best-builds.mjs            (slow: duel search, writes dev/out/best-builds.json)
#   node dev/sig-builds.mjs             (best build + the gun's own signatures -> dev/out/sig-builds.json)
#   node dev/sig-builds.mjs --only      (stock + signatures -> dev/out/sig-only.json)
# Combine by hand: node dev/kd-combine.mjs dev/out/pass/best-*.json --vs=$(ls dev/out/pass/stock-*.json | paste -sd,)
set -e
cd "$(dirname "$0")/.."
SEEDS=${SEEDS:-"1 2 3 4 5 6"}
ROUNDS=${ROUNDS:-2}
OUT=${OUT:-dev/out/pass}
CONFIGS=${*:-"stock best sig"}
mkdir -p "$OUT"
for c in $CONFIGS; do
  case $c in
    stock) B="" ;;
    best) B="--builds=dev/out/best-builds.json" ;;
    sig) B="--builds=dev/out/sig-builds.json" ;;
    sigonly) B="--builds=dev/out/sig-only.json" ;;
    *) echo "unknown config $c"; exit 2 ;;
  esac
  for s in $SEEDS; do
    node dev/balance-sim.mjs --no-duels --rounds="$ROUNDS" --seed="$s" $B --json="$OUT/$c-$s.json" > "$OUT/$c-$s.txt" &
  done
  wait
  echo "== $c =="
  if [ "$c" = stock ]; then node dev/kd-combine.mjs "$OUT"/stock-*.json
  else node dev/kd-combine.mjs "$OUT"/"$c"-*.json --vs="$(ls "$OUT"/stock-*.json | paste -sd, -)"; fi
done
