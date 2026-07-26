/**
 * Shared mock IAQ generator — used by the browser twin and the chat API
 * so both report the same temperature / humidity / CO₂ for a room.
 */

export function seeded(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return () => (h = (h * 48271) % 2147483647) / 2147483647;
}

export function inferRoomProfile(name = "") {
  const n = name.toLowerCase();
  if (/keuken|kitchen|kook/.test(n)) return "kitchen";
  if (/slaap|bed|sleep/.test(n)) return "bedroom";
  if (/bad|bath|douche|toilet|wc/.test(n)) return "wet";
  if (/woon|living|zit/.test(n)) return "living";
  if (/kantoor|office|werk|study/.test(n)) return "office";
  if (/berging|storage|garage|kelder/.test(n)) return "storage";
  return "default";
}

/** Deterministic mock reading for a room (stable across UI + chat API). */
export function mockReading(roomId, roomName = "") {
  const rnd = seeded(roomId);
  const profile = inferRoomProfile(roomName);
  let temp = 21;
  let humidity = 48;
  let co2 = 520;

  switch (profile) {
    case "kitchen":
      temp = 22.5 + rnd() * 2;
      humidity = 42 + rnd() * 18;
      co2 = 780 + rnd() * 520;
      break;
    case "living":
      temp = 21.5 + rnd() * 2.5;
      humidity = 38 + rnd() * 22;
      co2 = 650 + rnd() * 450;
      break;
    case "bedroom":
      temp = 20 + rnd() * 2;
      humidity = 45 + rnd() * 20;
      co2 = 900 + rnd() * 400;
      break;
    case "wet":
      temp = 23 + rnd() * 1.5;
      humidity = 58 + rnd() * 22;
      co2 = 480 + rnd() * 200;
      break;
    case "office":
      temp = 21 + rnd() * 2;
      humidity = 40 + rnd() * 15;
      co2 = 720 + rnd() * 380;
      break;
    case "storage":
      temp = 18 + rnd() * 3;
      humidity = 50 + rnd() * 15;
      co2 = 420 + rnd() * 180;
      break;
    default:
      temp = 20.5 + rnd() * 3;
      humidity = 40 + rnd() * 25;
      co2 = 500 + rnd() * 350;
  }

  return {
    room_id: roomId,
    timestamp: new Date().toISOString(),
    temperature: Math.round(temp * 10) / 10,
    humidity: Math.round(humidity),
    co2: Math.round(co2),
  };
}

export function iaqStatusFromCo2(co2) {
  if (co2 > 1000) return "poor";
  if (co2 > 800) return "moderate";
  return "good";
}
