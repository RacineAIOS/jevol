export const SEASONS = {
  summer: { grassDry: 0, autumn: 0 },
  autumn: { grassDry: 0.72, autumn: 0.8 },
};

export const STRAW = [0.36, 0.3, 0.15];

export const SEASON = { name: 'summer', ...SEASONS.summer };

export function seasonOfDate(date = new Date()) {
  const month = date.getMonth();
  return month >= 8 && month <= 10 ? 'autumn' : 'summer';
}

export function setSeason(name) {
  const key = SEASONS[name] ? name : seasonOfDate();
  Object.assign(SEASON, { name: key, ...SEASONS[key] });
  return SEASON;
}

export const AUTUMN_TINTS = [
  [1.55, 1.1, 0.6],
  [2.5, 1.25, 0.4],
  [2.9, 1.0, 0.35],
  [2.0, 0.9, 0.5],
];
export const AUTUMN_WEIGHTS = [0.34, 0.45, 0.18, 0.03];
export const AUTUMN_SHARE = {
  birch: 0.95, poplar: 0.9, chestnut: 0.9, hornbeam: 0.9, willow: 0.8, shrub: 0.8, oak: 0.7, pine: 0, spruce: 0,
};
