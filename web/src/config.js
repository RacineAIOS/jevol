export const MAP = 'flight-field';
export const DATA = `/data/${MAP}`;

export const SETTINGS = {
  mission: new URLSearchParams(location.search).get('mission') || 'Fly through the arches.',
  takeoffHeight: 2,
  period: 0.4,
  speedScale: 1,
  imageWidth: 672,
  flightFps: 24,
  flightPixelRatio: 1.5,
  slowPixelRatio: 1,
  slowWarmMs: 400,
  missionExamples: [
    'Fly forward along the road.',
    'Follow the road',
    'Fly up to the yellow car',
    'Go to the blue container',
    'Go to the billboard',
    'Go to the smallest house',
    'Fly through the next arch.',
    'Hold position.',
  ],
};
