const DEG = Math.PI / 180;
const OBJECT_TEMPLATES = ['Fly up to the {n}{side}.', 'Approach the {n}{side}.', 'Fly up close to the {n}{side}.'];
const LANE_LEAD_M = 12;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function createBench({ robotView, pilot, objects, starts, line, laneMissions }) {
  const centre = [objects.reduce((a, o) => a + o.x, 0) / objects.length, objects.reduce((a, o) => a + o.y, 0) / objects.length];

  function objectTrial() {
    const [x, y] = pick(starts);
    const yaw = Math.atan2(centre[1] - y, centre[0] - x);
    const target = pick(objects);
    const bearing = wrap(Math.atan2(target.y - y, target.x - x) - yaw) / DEG;
    const side = Math.abs(bearing) < 15 ? '' : bearing > 0 ? ' on your left' : ' on your right';
    return { start: [x, y, yaw], mission: pick(OBJECT_TEMPLATES).replace('{n}', target.name).replace('{side}', side) };
  }

  function laneTrial() {
    const [ax, ay] = line[0];
    const [bx, by] = line[1];
    const len = Math.hypot(bx - ax, by - ay);
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    return { start: [ax - dx * LANE_LEAD_M, ay - dy * LANE_LEAD_M, Math.atan2(dy, dx)], mission: pick(laneMissions) };
  }

  const trials = { Digit2: objectTrial, Digit3: laneTrial };

  function arm(key) {
    const trial = trials[key]?.();
    if (!trial) return;
    if (pilot.running) pilot.stop();
    robotView.placeRobot('drone', ...trial.start);
    pilot.setMission(trial.mission);
  }

  const onKey = (e) => {
    if (e.repeat || e.altKey || e.metaKey || e.ctrlKey) return;
    arm(e.code);
  };
  window.addEventListener('keydown', onKey);
  return { arm, close() { window.removeEventListener('keydown', onKey); } };
}
