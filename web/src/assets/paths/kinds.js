export const KINDS = {
  gravel: {
    soil: [152, 134, 108], stone: [176, 158, 130], stoneDensity: 0.7, stoneSize: 0.04,
    rutOff: 0.7, rutDepth: 0.02, strip: 0, wet: 0, encroach: 0.55, wobble: 0.28, dryness: 0.85,
    vergeWidth: 1.6, vergeH: [0.35, 0.85], edgeRate: 7, stripRate: 0, stoneRate: 0.3,
  },
  dirt_pebbles: {
    soil: [150, 118, 88], stone: [186, 164, 134], stoneDensity: 0.32, stoneSize: 0.05,
    rutOff: 0.75, rutDepth: 0.05, strip: 0, wet: 0.35, encroach: 0.6, wobble: 0.3, dryness: 0.35,
    vergeWidth: 1.2, vergeH: [0.15, 0.5], edgeRate: 5, stripRate: 0, stoneRate: 0.5,
  },
  two_strips: {
    soil: [160, 146, 124], stone: [178, 164, 140], stoneDensity: 0.8, stoneSize: 0.03,
    rutOff: 0.9, rutDepth: 0.015, strip: 0.2, wet: 0, encroach: 0.4, wobble: 0.22, dryness: 0.15,
    vergeWidth: 1.4, vergeH: [0.3, 0.7], edgeRate: 6, stripRate: 9, stoneRate: 0.2,
  },
  heath: {
    soil: [152, 120, 90], stone: [174, 154, 126], stoneDensity: 0.38, stoneSize: 0.05,
    rutOff: 0.8, rutDepth: 0.07, strip: 0.22, wet: 0.4, encroach: 0.65, wobble: 0.35, dryness: 0.9,
    vergeWidth: 2.0, vergeH: [0.35, 0.8], edgeRate: 8, stripRate: 6, stoneRate: 0.35,
  },
  site_gravel: {
    site: true,
    soil: [210, 198, 172], stone: [240, 232, 212], stoneDensity: 0.88, stoneSize: 0.03,
    rutOff: 0.85, rutDepth: 0.03, strip: 0.16, wet: 0.3, encroach: 0.5, wobble: 0.3, dryness: 0.6,
    vergeWidth: 1.4, vergeH: [0.15, 0.5], edgeRate: 5, stripRate: 4, stoneRate: 0.6,
  },
  gravel_alley: {
    soil: [186, 168, 138], stone: [206, 188, 156], stoneDensity: 0.9, stoneSize: 0.025,
    rutOff: 0, rutDepth: 0, strip: 0, wet: 0, encroach: 0.18, wobble: 0.12, dryness: 0.3,
    vergeWidth: 0.9, vergeH: [0.1, 0.3], edgeRate: 3.5, stripRate: 0, stoneRate: 0.15,
  },
  trail: {
    soil: [122, 102, 78], stone: [150, 136, 112], stoneDensity: 0.22, stoneSize: 0.03,
    rutOff: 0, rutDepth: 0, strip: 0, wet: 0.1, encroach: 0.9, wobble: 0.22, dryness: 0.5,
    vergeWidth: 1.2, vergeH: [0.25, 0.7], edgeRate: 7, stripRate: 0, stoneRate: 0.1,
  },
  dirt: {
    soil: [126, 101, 76], stone: [165, 148, 124], stoneDensity: 0.12, stoneSize: 0.05,
    rutOff: 0.75, rutDepth: 0.085, strip: 0.15, wet: 0.7, encroach: 0.5, wobble: 0.3, dryness: 0.4,
    vergeWidth: 1.3, vergeH: [0.2, 0.6], edgeRate: 5, stripRate: 3, stoneRate: 0.12,
  },
};

export function pickKind(nature, width, rng) {
  if (nature === 'Trail' || width < 2) return 'trail';
  if (nature === 'Gravel road') {
    const list = ['gravel', 'gravel'];
    if (width >= 3.2) list.push('two_strips');
    list.push('gravel_alley');
    return rng.pick(list);
  }
  const list = ['dirt', 'dirt_pebbles', 'heath'];
  if (width >= 3) list.push('two_strips');
  return rng.pick(list);
}

export function kindParams(name, width, rng) {
  const k = KINDS[name];
  const hw = width / 2;
  const jitter = (c) => {
    const f = rng.range(0.92, 1.08);
    return c.map((v) => Math.min(255, v * f));
  };
  const p = {
    ...k,
    name,
    soil: jitter(k.soil),
    stone: jitter(k.stone),
    stoneDensity: Math.min(1, k.stoneDensity * rng.range(0.8, 1.2)),
    rutDepth: k.rutDepth * rng.range(0.7, 1.3),
    wet: Math.min(1, k.wet * rng.range(0.6, 1.3)),
    dryness: Math.min(1, Math.max(0, k.dryness + rng.range(-0.15, 0.15))),
  };
  p.rutOff = k.rutOff > 0 ? Math.min(k.rutOff * rng.range(0.9, 1.1), hw * 0.55) : 0;
  p.strip = k.strip > 0 ? Math.max(0.12, k.strip * hw * rng.range(0.8, 1.2)) : 0;
  if (name === 'two_strips') p.rutOff = hw * 0.55;
  return p;
}
