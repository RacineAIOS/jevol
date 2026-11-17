export const SHAPES = {
  hatch: {
    top: [[0, 0.6, 'p'], [0.04, 0.8, 'p'], [0.27, 1, 'g'], [0.56, 1, 'p'], [0.7, 0.66, 'g'], [0.96, 0.56, 'p'], [1, 0.5, 'p']],
    belt: 0.66, glass: [[0.3, 0.45], [0.48, 0.66]], roofK: 0.84, smooth: true,
  },
  hatchShort: {
    top: [[0, 0.6, 'p'], [0.04, 0.82, 'p'], [0.25, 1, 'g'], [0.58, 1, 'p'], [0.74, 0.66, 'g'], [0.96, 0.58, 'p'], [1, 0.52, 'p']],
    belt: 0.66, glass: [[0.28, 0.5], [0.52, 0.7]], roofK: 0.84, smooth: true,
  },
  sedan: {
    top: [[0, 0.6, 'p'], [0.2, 0.64, 'p'], [0.4, 1, 'g'], [0.62, 1, 'p'], [0.76, 0.64, 'g'], [0.95, 0.58, 'p'], [1, 0.5, 'p']],
    belt: 0.64, glass: [[0.4, 0.545], [0.575, 0.72]], roofK: 0.8, smooth: true,
  },
  wagon: {
    top: [[0, 0.64, 'p'], [0.03, 0.84, 'p'], [0.08, 0.97, 'g'], [0.62, 1, 'p'], [0.74, 0.64, 'g'], [0.96, 0.57, 'p'], [1, 0.5, 'p']],
    belt: 0.64, glass: [[0.1, 0.4], [0.43, 0.7]], roofK: 0.82, smooth: true, rails: true,
  },
  suv: {
    top: [[0, 0.62, 'p'], [0.04, 0.9, 'p'], [0.08, 0.98, 'g'], [0.58, 1, 'p'], [0.74, 0.7, 'g'], [0.96, 0.64, 'p'], [1, 0.56, 'p']],
    belt: 0.66, glass: [[0.1, 0.4], [0.43, 0.7]], roofK: 0.86, smooth: true, rails: true,
  },
  mpv: {
    top: [[0, 0.6, 'p'], [0.03, 0.9, 'p'], [0.07, 0.99, 'g'], [0.7, 1, 'p'], [0.82, 0.63, 'g'], [0.97, 0.58, 'p'], [1, 0.5, 'p']],
    belt: 0.6, glass: [[0.1, 0.4], [0.43, 0.8]], roofK: 0.88, smooth: true, rails: true,
  },
  van: {
    top: [[0, 0.56, 'p'], [0.02, 0.97, 'p'], [0.05, 1, 'p'], [0.7, 1, 'p'], [0.8, 0.62, 'g'], [0.97, 0.58, 'p'], [1, 0.52, 'p']],
    belt: 0.6, glass: [[0.64, 0.79]], roofK: 0.94, smooth: false,
  },
  panel: {
    top: [[0, 0.5, 'p'], [0.015, 0.99, 'p'], [0.04, 1, 'p'], [0.74, 1, 'p'], [0.88, 0.66, 'g'], [0.98, 0.6, 'p'], [1, 0.5, 'p']],
    belt: 0.6, glass: [[0.77, 0.87]], roofK: 0.96, smooth: false,
  },
  pickup: {
    top: [[0, 0.62, 'p'], [0.4, 0.62, 'b'], [0.41, 0.93, 'p'], [0.44, 1, 'g'], [0.7, 1, 'p'], [0.8, 0.7, 'g'], [0.97, 0.62, 'p'], [1, 0.54, 'p']],
    belt: 0.7, glass: [[0.45, 0.555], [0.575, 0.78]], roofK: 0.88, smooth: true,
  },
};

export const MODELS = {
  cityCarA: { cls: 'city car', shape: 'hatchShort', L: 4.055, W: 1.765, H: 1.43, wheelbase: 2.54, overhang: 0.86, r: 0.31, gc: 0.13, tw: 0.2 },
  cityCarB: { cls: 'city car', shape: 'hatchShort', L: 3.6, W: 1.65, H: 1.56, wheelbase: 2.49, overhang: 0.72, r: 0.3, gc: 0.15, tw: 0.185 },
  compactA: { cls: 'compact', shape: 'hatch', L: 4.28, W: 1.79, H: 1.46, wheelbase: 2.62, overhang: 0.9, r: 0.32, gc: 0.14, tw: 0.205 },
  compactB: { cls: 'compact', shape: 'hatch', L: 4.37, W: 1.85, H: 1.44, wheelbase: 2.67, overhang: 0.92, r: 0.33, gc: 0.14, tw: 0.215 },
  sedan: { cls: 'sedan', shape: 'sedan', L: 4.75, W: 1.82, H: 1.44, wheelbase: 2.84, overhang: 0.9, r: 0.33, gc: 0.13, tw: 0.215 },
  estate: { cls: 'estate', shape: 'wagon', L: 4.64, W: 1.85, H: 1.47, wheelbase: 2.73, overhang: 0.92, r: 0.33, gc: 0.14, tw: 0.215 },
  suvS: { cls: 'suv', shape: 'suv', L: 4.3, W: 1.77, H: 1.55, wheelbase: 2.6, overhang: 0.88, r: 0.33, gc: 0.19, tw: 0.2 },
  suvM: { cls: 'suv', shape: 'suv', L: 4.447, W: 1.841, H: 1.62, wheelbase: 2.68, overhang: 0.9, r: 0.35, gc: 0.2, tw: 0.225 },
  suvL: { cls: 'suv', shape: 'suv', L: 4.7, W: 1.92, H: 1.7, wheelbase: 2.8, overhang: 0.95, r: 0.37, gc: 0.21, tw: 0.235 },
  mpv: { cls: 'mpv', shape: 'mpv', L: 4.41, W: 1.87, H: 1.65, wheelbase: 2.73, overhang: 0.87, r: 0.34, gc: 0.15, tw: 0.215 },
  leisure: { cls: 'mpv', shape: 'van', L: 4.4, W: 1.85, H: 1.8, wheelbase: 2.78, overhang: 0.86, r: 0.32, gc: 0.17, tw: 0.2, glassRear: true },
  smallVan: { cls: 'small van', shape: 'van', L: 4.49, W: 1.92, H: 1.82, wheelbase: 2.72, overhang: 0.86, r: 0.32, gc: 0.17, tw: 0.2 },
  vanM: { cls: 'van', shape: 'panel', L: 5.575, W: 2.07, H: 2.5, wheelbase: 3.68, overhang: 0.95, r: 0.36, gc: 0.2, tw: 0.235 },
  vanL: { cls: 'van', shape: 'panel', L: 6.2, W: 2.07, H: 2.5, wheelbase: 4.33, overhang: 0.95, r: 0.36, gc: 0.2, tw: 0.235 },
  pickup: { cls: 'pickup', shape: 'pickup', L: 5.33, W: 1.855, H: 1.815, wheelbase: 3.085, overhang: 0.95, r: 0.4, gc: 0.28, tw: 0.265 },
};

export const PAINTS = [
  { name: 'dark grey', w: 27, c: [[70, 74, 79], [58, 62, 66], [88, 92, 96]] },
  { name: 'black', w: 22, c: [[22, 23, 25], [14, 14, 16], [30, 31, 34]] },
  { name: 'white', w: 21, c: [[232, 232, 228], [220, 221, 218], [240, 240, 238]] },
  { name: 'blue', w: 11, c: [[34, 62, 112], [20, 44, 86], [70, 98, 140], [12, 30, 58]] },
  { name: 'light grey', w: 9, c: [[168, 171, 175], [190, 192, 195], [150, 153, 158]] },
  { name: 'red', w: 5, c: [[140, 24, 28], [168, 38, 34], [96, 14, 20]] },
  { name: 'brown/beige', w: 2, c: [[168, 150, 120], [96, 76, 60]] },
  { name: 'green', w: 1, c: [[48, 82, 62], [30, 58, 48]] },
  { name: 'yellow/gold', w: 1, c: [[200, 160, 40], [184, 140, 70]] },
  { name: 'others', w: 1, c: [[196, 96, 34], [110, 60, 120]] },
];
