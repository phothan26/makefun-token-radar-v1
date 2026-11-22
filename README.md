# makefun-token-radar-v1

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/phothan26/makefun-token-radar-v1/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/phothan26/makefun-token-radar-v1/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

LAUNCH RADAR — The Pre-Token 758. A token-launch radar that reads the sealed DefiLlama snapshot of 758 protocols, scores every protocol that records no token with a model derived from the snapshot's own figures (log TVL, 7-day growth, age, chain breadth, a category multiplier from median TVL, and a no-token bonus), ranks the top 300 by implied value, and hands in a dark-terminal dashboard with a sortable/filterable board, a detail view per protocol with a full factor breakdown and a generated farm plan, and two charts. The program also renders its own three screenshots from the real dashboard and writes the judge's dossier.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=t7e39kme&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
