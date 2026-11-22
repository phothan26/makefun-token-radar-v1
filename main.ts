// LAUNCH RADAR — the pre-token 758 (token-radar-01, variant 1).
//
// Reads the sealed DefiLlama snapshot, scores every protocol with a model
// derived from the snapshot's own figures, writes the ranked 300-row board,
// the dashboard data, renders three screenshots of the real dashboard with a
// headless browser (falling back to the repository's own screenshots when no
// browser is available), and writes the judge's dossier with make.fun's
// vendored library.
//
//   node main.ts --input <snapshot.json|dir> --output <dir>
//   MAKEFUN_OUTPUT_DIR stands in for --output; /input and /output are the
//   defaults. Node 22, standard library only. Deterministic: no clock, no
//   randomness, no network; ties break by slug.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SHOT_MAX_BYTES = 524_288;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// ---------------------------------------------------------------- snapshot

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
  process.stderr.write('launch radar: snapshot is not the sealed shape\n');
  process.exit(2);
}
const asOf = new Date(`${snapshot.as_of}T00:00:00Z`).getTime();
const watchlist = new Set(snapshot.watchlist);

// ---------------------------------------------------------------- the model
//
// score = (base + growth + age + breadth) * categoryMultiplier + noTokenBonus
//   base    10 * ln(tvl / $1M)                  — log scale, not linear
//   growth  8 * clamp(change_7d, -25, +50) / 50 — a wild week cannot dominate
//   age     1.2 * min(years listed, 6)          — survival is a signal
//   breadth 2.5 * ln(1 + min(chains, 20))       — more surface to farm
//   category multiplier from the category's median TVL in this snapshot
//   no-token bonus +12 when no token is recorded at all
// implied value = 10^(6.3 + 3.0 * norm(score)), 4 significant figures:
// the top row lands near $2B, the bottom near $2M, monotone with the score.

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const medianAll = median(snapshot.protocols.map((p) => p.tvl_usd));
const catTvls = new Map<string, number[]>();
for (const p of snapshot.protocols) {
  if (p.category === null) continue;
  const arr = catTvls.get(p.category) ?? [];
  arr.push(p.tvl_usd);
  catTvls.set(p.category, arr);
}
const catMult = new Map<string, number>();
for (const [cat, tvls] of catTvls) {
  catMult.set(cat, clamp(0.85 + (0.3 * (Math.log(median(tvls)) - Math.log(medianAll))) / 4, 0.8, 1.25));
}

interface Factors { base: number; growth: number; age: number; breadth: number; cat: number; bonus: number; score: number; }

function factors(p: Protocol): Factors {
  const base = 10 * Math.log(p.tvl_usd / 1e6);
  const growth = (8 * clamp(p.change_7d ?? 0, -25, 50)) / 50;
  let age: number;
  if (p.listed_at !== null) {
    const years = (asOf - new Date(`${p.listed_at}T00:00:00Z`).getTime()) / 86400000 / 365.25;
    age = 1.2 * clamp(years, 0, 6);
  } else {
    age = 2.4;
  }
  const breadth = 2.5 * Math.log(1 + Math.min(p.chains.length, 20));
  const cat = p.category === null ? 1 : catMult.get(p.category) ?? 1;
  const bonus = p.gecko_id === null && p.symbol === null ? 12 : 0;
  const score = (base + growth + age + breadth) * cat + bonus;
  return { base, growth, age, breadth, cat, bonus, score };
}

const noToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;

interface Scored { p: Protocol; f: Factors; }
const scored: Scored[] = snapshot.protocols
  .filter(noToken)
  .map((p) => ({ p, f: factors(p) }));
scored.sort((a, b) => b.f.score - a.f.score || (a.p.slug < b.p.slug ? -1 : 1));

const boardRows: Scored[] = [
  ...scored.filter((s) => watchlist.has(s.p.slug)),
  ...scored.filter((s) => !watchlist.has(s.p.slug)).slice(0, 260),
];
boardRows.sort((a, b) => b.f.score - a.f.score || (a.p.slug < b.p.slug ? -1 : 1));
if (boardRows.length !== 300) {
  process.stderr.write(`launch radar: board holds ${boardRows.length} rows, expected 300\n`);
  process.exit(1);
}

const lo = boardRows[boardRows.length - 1]!.f.score;
const hi = boardRows[0]!.f.score;
const valueOf = (score: number): number => {
  const norm = (score - lo) / (hi - lo);
  return Number(Math.pow(10, 6.3 + 3.0 * norm).toPrecision(4));
};

// ---------------------------------------------------------------- farm plans
//
// Every step names things true of THIS protocol: its category's farming
// pattern, its chains, its scale. Steps carry what it costs and how long it
// takes. 6 steps on one chain, 7 on several.

const money = (usd: number): string => {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${Math.round(usd / 1e3)}K`;
};

const familyOf = (category: string | null): string => {
  switch (category) {
    case 'Dexs': return 'dex';
    case 'Lending': return 'lending';
    case 'Bridge':
    case 'Canonical Bridge': return 'bridge';
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaked BTC': return 'staking';
    case 'Derivatives':
    case 'Perps': return 'perps';
    case 'Yield':
    case 'Yield Aggregator': return 'yield';
    case 'RWA': return 'rwa';
    case 'CEX': return 'cex';
    default: return 'generic';
  }
};

function farmSteps(p: Protocol): string[] {
  const name = p.name;
  const c1 = p.chains[0] ?? 'its home chain';
  const c2 = p.chains[1] ?? null;
  const multi = p.chains.length > 1;
  const tvl = money(p.tvl_usd);
  const steps: string[] = [];
  steps.push(
    `Set up a fresh wallet for ${name} only, fund it with enough ${c1} gas for a month of activity, and keep that wallet separate from your main holdings so the farm stays clean and easy to track.`,
  );
  const fam = familyOf(p.category);
  if (fam === 'dex') {
    steps.push(`Provide liquidity in the deepest ${name} pool on ${c1}: pair the chain's native asset with a stablecoin, keep the position open for at least four weeks, and let the trading fees compound instead of withdrawing early.`);
    steps.push(`Swap through ${name} on ${c1} at least twice a week, splitting volume across several days rather than one large trade, so the activity reads as genuine use and not a single burst.`);
  } else if (fam === 'lending') {
    steps.push(`Supply assets to the ${name} lending market on ${c1} and leave the deposit earning for at least four weeks; a supply position that stays open is the core signal for a lending protocol.`);
    steps.push(`Borrow a modest amount against the supply on ${c1} — no more than a third of the collateral value — and repay it in full, to show both sides of the market without risking liquidation.`);
  } else if (fam === 'bridge') {
    if (c2 !== null) {
      steps.push(`Bridge a modest amount through ${name} from ${c1} to ${c2} at least twice a month, using different asset sizes, so the record shows repeated real bridging rather than a single test.`);
    } else {
      steps.push(`Bridge a modest amount through ${name} on ${c1} at least twice a month, using different asset sizes, so the record shows repeated real bridging rather than a single test.`);
    }
    steps.push(`Use ${name} for a larger, planned transfer once a quarter — moving funds you actually need on the destination chain — because one genuine large bridge counts more than many tiny ones.`);
  } else if (fam === 'staking') {
    steps.push(`Stake through ${name} on ${c1} and keep the stake active for at least six weeks; a stake that stays put is the core signal for a staking protocol.`);
    steps.push(`Use the receipt token the stake returns — provide it as collateral or liquidity on ${c1} — so the position works twice without unstaking.`);
  } else if (fam === 'perps') {
    steps.push(`Open small perpetual positions on ${name} on ${c1} a few times a week, with low leverage, and close them the same day; the venue rewards regular traders, not one large bet.`);
    steps.push(`Trade both directions over time — longs and shorts on ${c1} — so the record shows a real trader rather than a single directional punt.`);
  } else if (fam === 'yield') {
    steps.push(`Deposit into the highest-yield ${name} vault on ${c1} and leave the deposit compounding for at least four weeks instead of hopping between vaults every few days.`);
    steps.push(`Move a second, smaller deposit into a different ${name} vault on ${c1} after the first month, to show you use more than one of the protocol's products.`);
  } else if (fam === 'rwa') {
    steps.push(`Buy a small position in a tokenised real-world asset on ${name} on ${c1} and hold it for at least a month; the protocol's value is in assets that stay put.`);
    steps.push(`Reinvest the yield the position pays into the same ${name} market on ${c1}, so the record shows compounding rather than a one-off purchase.`);
  } else if (fam === 'cex') {
    steps.push(`Trade regularly on ${name}: place spot trades in its ${c1} markets a few times a week, in varied sizes, so the account shows a real trading history.`);
    steps.push(`Use more than spot: try the venue's earn product or a futures market on ${name} once, with a small amount, to show you use the platform beyond a single feature.`);
  } else {
    steps.push(`Use ${name} on ${c1} at least twice a week for a month — deposit, interact and withdraw in small amounts — so the record shows sustained use rather than one visit.`);
    steps.push(`Try a second feature of ${name} on ${c1} after the first week, so the activity covers more than the single action every farmer does.`);
  }
  if (p.tvl_usd >= 1e9) {
    steps.push(`Size positions modestly: ${name} already holds ${tvl} in TVL, so a small long-lived position counts more than a large deposit that leaves after a week.`);
  } else if (p.tvl_usd >= 5e7) {
    steps.push(`${name} holds ${tvl} in TVL, a mid-sized protocol where steady weekly use stands out — keep deposits proportionate and stay active for at least a month.`);
  } else {
    steps.push(`${name} holds only ${tvl} in TVL, so you are early — keep deposits small, use steady weekly activity, and expect the rules or the interface to change.`);
  }
  if (multi && c2 !== null) {
    steps.push(`Repeat the core action on ${c2}: ${name} runs on ${p.chains.length} chains, and activity on a second chain shows breadth instead of a single-chain farm.`);
  }
  if (fam === 'dex') {
    steps.push(`Watch impermanent loss: if the paired assets drift apart, the liquidity position loses value against simply holding them, so check the pool's ratio weekly.`);
  } else if (fam === 'lending') {
    steps.push(`Watch the liquidation line: if the borrowed asset rises against your collateral, the position can be liquidated, so keep the borrow well below the limit and check the health factor weekly.`);
  } else if (fam === 'bridge') {
    steps.push(`Bridge risk is real: funds in transit depend on ${name}'s contracts and relayers, so never bridge more than you can afford to have delayed, and test with a small amount first.`);
  } else if (fam === 'staking') {
    steps.push(`Mind the unstaking delay and slashing: exiting can take days, and a validator fault can cut the stake, so never stake funds you may need at short notice.`);
  } else if (fam === 'perps') {
    steps.push(`Leverage liquidates fast: keep every position small, use low leverage, and set a stop level before you open, because a sharp move can wipe a margined position in minutes.`);
  } else if (fam === 'yield') {
    steps.push(`Vault yields are not guaranteed: the underlying strategies carry smart-contract risk, so spread deposits across vaults and never put everything in the newest one.`);
  } else if (fam === 'rwa') {
    steps.push(`Real-world assets carry off-chain risk: the token is only as good as the issuer and custodian behind it, so read who holds the underlying asset before you deposit.`);
  } else if (fam === 'cex') {
    steps.push(`A centralised venue holds your funds: keep only what you are actively trading on ${name}, withdraw the rest to a wallet you control, and enable every security check the account offers.`);
  } else {
    steps.push(`Smart-contract risk applies: ${name}'s contracts hold your funds while you farm, so start with a small test amount and scale up only after the first week.`);
  }
  steps.push(`Record every deposit, swap and withdrawal for ${name} with dates and amounts in one place, so you can prove the activity if the launch asks for it.`);
  return steps;
}

// ---------------------------------------------------------------- the board

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

const board: BoardRow[] = boardRows.map((s, i) => ({
  slug: s.p.slug,
  name: s.p.name,
  rank: i + 1,
  implied_value_usd: valueOf(s.f.score),
  farm_steps: farmSteps(s.p),
}));

// The gate's own checks, run here so a bad board fails loudly, never silently.
function boardIssue(): string | null {
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i + 1} names an unknown slug ${r.slug}`;
    if (r.name.trim().length === 0) return `row ${i + 1} has an empty name`;
    if (r.rank !== i + 1) return `row ${i + 1} has rank ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `row ${i + 1} has implied value ${r.implied_value_usd}`;
    }
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `implied value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i + 1} has ${r.farm_steps.length} farm steps`;
    for (const st of r.farm_steps) {
      const t = st.trim();
      if (t.length < 20 || t.length > 600) return `row ${i + 1} has a farm step of ${t.length} chars`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'all implied values are equal';
  for (const slug of snapshot.watchlist) {
    if (!board.some((r) => r.slug === slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}
const issue = boardIssue();
if (issue !== null) {
  process.stderr.write(`launch radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- outputs

const outDashboard = join(out, 'dashboard');
const outShots = join(out, 'screenshots');

function chmodFile(path: string): void {
  try { chmodSync(path, 0o644); } catch { /* the file is written either way */ }
}
function chmodDir(path: string): void {
  try { chmodSync(path, 0o755); } catch { /* the directory is made either way */ }
}

mkdirSync(out, { recursive: true });
mkdirSync(outDashboard, { recursive: true });
chmodDir(outDashboard);
mkdirSync(outShots, { recursive: true });
chmodDir(outShots);

writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
chmodFile(join(out, 'board.json'));

// The dashboard's data: the board plus the factor breakdown and the chart
// aggregates, as one script the page reads. Nothing here leaves the machine.
const byCatTvl = new Map<string, { tvl: number; count: number }>();
for (const p of snapshot.protocols) {
  const k = p.category ?? 'Uncategorised';
  const e = byCatTvl.get(k) ?? { tvl: 0, count: 0 };
  e.tvl += p.tvl_usd;
  e.count += 1;
  byCatTvl.set(k, e);
}
const cats = [...byCatTvl.entries()]
  .map(([name, e]) => ({ name, tvl: e.tvl, count: e.count }))
  .sort((a, b) => b.tvl - a.tvl)
  .slice(0, 10);

const round2 = (x: number): number => Math.round(x * 100) / 100;
const data = {
  meta: {
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    totalProtocols: snapshot.protocols.length,
    noToken: snapshot.protocols.filter(noToken).length,
    tokenedSetAside: snapshot.protocols.filter((p) => !noToken(p)).length,
    watchlistCount: snapshot.watchlist.length,
    boardSize: board.length,
    topPick: board[0]!.slug,
  },
  cats,
  rows: boardRows.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    value: board[i]!.implied_value_usd,
    tvl: s.p.tvl_usd,
    chg: s.p.change_7d,
    cat: s.p.category,
    chains: s.p.chains,
    listed: s.p.listed_at,
    wl: watchlist.has(s.p.slug),
    f: {
      base: round2(s.f.base),
      growth: round2(s.f.growth),
      age: round2(s.f.age),
      breadth: round2(s.f.breadth),
      cat: round2(s.f.cat),
      bonus: s.f.bonus,
      score: round2(s.f.score),
    },
    steps: board[i]!.farm_steps,
  })),
};
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(data).replace(/</g, '\\u003c')};\n`);
chmodFile(join(out, 'data.js'));

/** Copy one directory's regular files into `to`, skipping dot-names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  chmodDir(to);
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    chmodFile(join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), outDashboard);
const repoShots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

// ---------------------------------------------------------------- screenshots
//
// Rendered during the run from the real dashboard files, three views:
// the board, the top watchlist protocol's detail view, and a filtered view.
// A headless browser is found by path, then by the usual install spots; when
// none runs, the repository's own screenshots (made the same way) stand in,
// so the run still hands in valid screenshots in a bare container.

function pngDims(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

function shotOk(path: string): boolean {
  try {
    const b = readFileSync(path);
    if (b.length > SHOT_MAX_BYTES) return false;
    const d = pngDims(b);
    if (d === null) return false;
    const long = Math.max(d.w, d.h);
    const short = Math.min(d.w, d.h);
    return long <= 1440 && short >= 800;
  } catch {
    return false;
  }
}

const home = process.env.HOME ?? '';
const chromeCandidates = [
  process.env.CHROMIUM_PATH ?? '',
  '/opt/meta-chromium/chrome',
  join(home, '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'),
  join(home, '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'),
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((c) => c !== '' && existsSync(c));

const topWatchlist = boardRows.find((s) => watchlist.has(s.p.slug))!;
const topCategory = (() => {
  const counts = new Map<string, number>();
  for (const s of boardRows) counts.set(s.p.category ?? 'Uncategorised', (counts.get(s.p.category ?? 'Uncategorised') ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
})();
const pageUrl = `file://${resolve(outDashboard, 'index.html')}`;
const views: [string, string][] = [
  ['1-board.png', pageUrl],
  ['2-detail.png', `${pageUrl}#detail=${topWatchlist.p.slug}`],
  ['3-filter.png', `${pageUrl}#filter=${encodeURIComponent(topCategory)}`],
];

let rendered = false;
const noBrowser = process.env.LAUNCH_RADAR_NO_BROWSER === '1';
for (const chrome of noBrowser ? [] : chromeCandidates) {
  let ok = true;
  for (const [name, url] of views) {
    const dest = join(outShots, name);
    const r = spawnSync(
      chrome,
      [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--hide-scrollbars', '--force-device-scale-factor=1',
        '--window-size=1280,800', '--virtual-time-budget=8000',
        `--screenshot=${dest}`, url,
      ],
      { timeout: 60000, encoding: 'utf8' },
    );
    if (r.error !== undefined || !shotOk(dest)) { ok = false; break; }
    chmodFile(dest);
  }
  if (ok) { rendered = true; break; }
}
if (!rendered) {
  // No browser ran: the repository's own screenshots stand in.
  if (repoShots.length < 3 || !['1-board.png', '2-detail.png', '3-filter.png'].every((n) => shotOk(join(outShots, n)))) {
    process.stderr.write('launch radar: no headless browser ran and screenshots/ holds no valid set\n');
    process.exit(1);
  }
}
for (const name of ['1-board.png', '2-detail.png', '3-filter.png']) {
  if (!IMAGE_NAME.test(name) || !shotOk(join(outShots, name))) {
    process.stderr.write(`launch radar: screenshots/${name} is not a valid gate image\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- the dossier

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: SHOT_MAX_BYTES },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);
chmodFile(join(out, 'dossier.json'));

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `launch radar: top ${board[0]!.slug} ${money(board[0]!.implied_value_usd)} · bottom ${board[board.length - 1]!.slug} ${money(board[board.length - 1]!.implied_value_usd)}\n` +
    `launch radar: screenshots ${rendered ? 'rendered by a headless browser' : 'from the repository set'} · wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')}, ${join(out, 'dossier.json')}\n`,
);
