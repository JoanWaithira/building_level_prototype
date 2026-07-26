// Per-appliance interior cameras — fx/fy are -1..1 across the room footprint (inset from walls).
// Same approach as roomCameraOverrides.js — stays inside the room, distinct pose per appliance.

export const APPLIANCE_CAMERA = {
  // Keuken — four distinct corners / zones
  fridge: {
    eye: { fx: -0.55, fy: -0.65, up: 1.35 },
    aim: { fx: 0.72, fy: 0.55, up: 0.95 },
    fov: 68,
  },
  hob: {
    eye: { fx: 0.55, fy: -0.55, up: 1.4 },
    aim: { fx: -0.65, fy: 0.45, up: 0.95 },
    fov: 66,
  },
  oven: {
    eye: { fx: 0.45, fy: 0.55, up: 1.32 },
    aim: { fx: -0.7, fy: -0.55, up: 0.8 },
    fov: 66,
  },
  dishwash: {
    eye: { fx: -0.5, fy: 0.5, up: 1.28 },
    aim: { fx: 0.55, fy: -0.7, up: 0.55 },
    fov: 68,
  },

  // Wasruimte — washer left / dryer right of the appliance wall
  washer: {
    eye: { fx: -0.7, fy: -0.65, up: 1.28 },
    aim: { fx: -0.05, fy: 0.55, up: 0.72 },
    fov: 64,
  },
  dryer: {
    eye: { fx: -0.25, fy: -0.6, up: 1.32 },
    aim: { fx: 0.55, fy: 0.55, up: 0.95 },
    fov: 66,
  },

  // Woonkamer
  tv: {
    eye: { fx: -0.6, fy: 0.55, up: 1.4 },
    aim: { fx: 0.7, fy: -0.55, up: 0.95 },
    fov: 70,
  },

  // Kantoor / study
  pc: {
    eye: { fx: -0.55, fy: -0.5, up: 1.35 },
    aim: { fx: 0.5, fy: 0.45, up: 0.85 },
    fov: 68,
  },

  // Technical room
  boiler: {
    eye: { fx: -0.55, fy: 0.5, up: 1.45 },
    aim: { fx: 0.4, fy: -0.45, up: 1.25 },
    fov: 70,
  },
};

export function getApplianceCameraOverride(applianceId) {
  return APPLIANCE_CAMERA[applianceId] ?? null;
}
