// Per-room interior camera tuning — fx/fy are -1..1 across the footprint (inset from walls).
export const ROOM_CAMERA = {
  // Slaapkamer Rm 18 — desk side, looking across the bed (reference interior shot).
  LEVEL_1_18: {
    eye: { fx: 0.78, fy: -0.72, up: 1.52 },
    aim: { fx: -0.42, fy: 0.58, up: 1.02 },
    fov: 76,
  },
  // Wc Rm 4 — doorway view centred on the toilet (reference interior shot).
  LEVEL_0_4: {
    eye: { fx: -0.82, fy: -0.78, up: 1.38 },
    aim: { fx: 0.22, fy: 0.28, up: 0.92 },
    fov: 78,
  },
};

export function getRoomCameraOverride(roomId) {
  return ROOM_CAMERA[roomId] ?? null;
}
