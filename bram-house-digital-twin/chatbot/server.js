/**
 * Bram House Digital Twin — Chat API backend (OpenAI tool-calling).
 * Endpoints: POST /api/chat · GET /api/health
 *
 * Run: npm run server   (or npm run dev for UI + API)
 * Env:  chatbot/.env    (OPENAI_API_KEY)
 */
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mockReading, iaqStatusFromCo2 } from "../shared/iaqMock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
const PUBLIC = join(__dirname, "../public");

// ── Load building data once at startup ─────────────────────────────────────
const roomsGeoJSON = JSON.parse(readFileSync(join(PUBLIC, "data/bram_house_rooms.geojson"), "utf8"));
const appliancesData = JSON.parse(readFileSync(join(PUBLIC, "data/appliances.json"), "utf8"));
const powerCSV = readFileSync(join(PUBLIC, "energy/Total_power.csv"), "utf8");
const gasCSV = readFileSync(join(PUBLIC, "energy/Total_gas.csv"), "utf8");

// Minimal CSV parser (same logic as energyDataService.js)
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      const raw = (cells[i] ?? "").trim();
      if (h === "time") {
        const d = new Date(raw.replace(" ", "T"));
        row.time = isNaN(d) ? null : d;
      } else {
        const n = parseFloat(raw);
        row[h] = raw === "" || isNaN(n) ? null : n;
      }
    });
    return row;
  }).filter((r) => r.time);
}

function lastValid(rows, col) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][col] != null) return rows[i][col];
  }
  return null;
}

function firstValid(rows, col) {
  for (const r of rows) if (r[col] != null) return r[col];
  return null;
}

function delta(rows, col) {
  const a = firstValid(rows, col), b = lastValid(rows, col);
  return (a != null && b != null) ? +(b - a).toFixed(2) : null;
}

// Pre-compute energy summary
const powerRows = parseCSV(powerCSV);
const gasRows   = parseCSV(gasCSV);

const energySummary = {
  periodStart: powerRows[0]?.time?.toISOString().slice(0, 10) ?? "unknown",
  periodEnd:   powerRows.at(-1)?.time?.toISOString().slice(0, 10) ?? "unknown",
  totalImportKWh: delta(powerRows, "Import T1 kWh") != null
    ? +((delta(powerRows, "Import T1 kWh") ?? 0) + (delta(powerRows, "Import T2 kWh") ?? 0)).toFixed(1)
    : null,
  totalExportKWh: delta(powerRows, "Export T1 kWh") != null
    ? +((delta(powerRows, "Export T1 kWh") ?? 0) + (delta(powerRows, "Export T2 kWh") ?? 0)).toFixed(1)
    : null,
  latestGasM3: lastValid(gasRows, "Gas (m3)"),
};

// Build room index from GeoJSON
const rooms = roomsGeoJSON.features.map((f) => ({
  id: f.properties.room_id,
  name: f.properties.room_name,
  floor: f.properties.floor,
  number: f.properties.room_number,
  baseHeight: f.properties.base_height,
  extrudedHeight: f.properties.extruded_height,
}));

const appliances = appliancesData.appliances.map((a) => ({
  id: a.id,
  name: a.name,
  ratedW: a.ratedW,
  profile: a.profile,
  roomId: a.room_id ?? null,
  location: a.locationLabel ?? rooms.find((r) => r.id === a.room_id)?.name ?? "Outside",
}));

// ── MCP-style tool definitions (OpenAI function-calling schema) ─────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_building_info",
      description: "Get general information about Bram House: location, size, floor count, and purpose.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_rooms",
      description: "List all rooms in the building with their names, floor and room numbers.",
      parameters: {
        type: "object",
        properties: {
          floor: {
            type: "string",
            description: "Optional filter: 'Level 0' or 'Level 1'. Omit for all floors.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_room_iaq",
      description: "Get indoor air quality (temperature, humidity, CO₂) for a specific room.",
      parameters: {
        type: "object",
        required: ["room_id"],
        properties: {
          room_id: { type: "string", description: "The room_id, e.g. LEVEL_0_33" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_energy_summary",
      description: "Get building-level energy consumption and export totals for the monitored period.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_appliances",
      description: "List all monitored appliances with their room location and rated power.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to_room",
      description: "Navigate the 3D digital twin view to a specific room. Use this when the user asks to see or go to a room.",
      parameters: {
        type: "object",
        required: ["room_id"],
        properties: {
          room_id: { type: "string", description: "The room_id to navigate to, e.g. LEVEL_0_1" },
          room_name: { type: "string", description: "Human-readable room name for the confirmation message" },
        },
      },
    },
  },
];

// ── Tool execution ──────────────────────────────────────────────────────────
function executeTool(name, input = {}) {
  switch (name) {
    case "get_building_info":
      return {
        name: "Bram House",
        location: "Aadorp, Netherlands",
        project: "3DxVERSE — EU Sustainable Living Communities",
        totalRooms: rooms.length,
        floors: ["Level 0 (ground)", "Level 1 (first)"],
        features: ["GeoJSON room footprints", "IFC 3D shell", "Energy metering (P1)", "Indoor air quality sensors", "EV charger"],
        monitoredAppliances: appliances.length,
      };

    case "list_rooms": {
      let list = rooms;
      if (input.floor) {
        list = list.filter((r) => r.floor.toLowerCase() === input.floor.toLowerCase());
      }
      return list.map((r) => ({ id: r.id, name: r.name, floor: r.floor, number: r.number }));
    }

    case "get_room_iaq": {
      const room = rooms.find((r) => r.id === input.room_id);
      if (!room) return { error: `Room '${input.room_id}' not found.` };
      const reading = mockReading(room.id, room.name);
      return {
        room_id: room.id,
        room_name: room.name,
        floor: room.floor,
        temperature_C: reading.temperature,
        humidity_pct: reading.humidity,
        co2_ppm: reading.co2,
        air_quality: iaqStatusFromCo2(reading.co2),
      };
    }

    case "get_energy_summary":
      return {
        ...energySummary,
        note: "Import/export are cumulative meter deltas (kWh). Gas in m³.",
        dataSource: "P1 smart meter via HomeAssistant",
      };

    case "list_appliances":
      return appliances;

    case "navigate_to_room":
      // Handled by frontend — just acknowledge
      return { navigating: true, room_id: input.room_id, room_name: input.room_name };

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Express server ──────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const SYSTEM_PROMPT = `You are the AI assistant for the Bram House Digital Twin — a residential building in Aadorp, Netherlands, part of the 3DxVERSE EU project for Sustainable Living Communities.

You have access to real building data through tools: rooms, indoor air quality, energy consumption, and appliances. Use these tools to answer questions accurately.

Guidelines:
- Be concise and friendly.
- When asked about a specific room, retrieve its data before answering.
- When the user asks to "see", "go to", "show", or "navigate to" a room, call navigate_to_room.
- For IAQ concerns: CO₂ > 1000 ppm is poor, 800–1000 is moderate, < 800 is good.
- Energy data covers June 2025 – June 2026.
- Sensor readings are currently simulated (real sensors will be connected later).`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "missing" });

app.post("/api/chat", async (req, res) => {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "sk-...") {
    return res.status(503).json({ error: "OPENAI_API_KEY is not configured on the server." });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  try {
    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const pendingActions = [];

    // Agentic tool-use loop (max 6 rounds to avoid infinite loops)
    for (let round = 0; round < 6; round++) {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: chatMessages,
        tools: TOOLS,
        tool_choice: "auto",
      });

      const choice = response.choices[0];
      const msg = choice.message;

      if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
        return res.json({ reply: msg.content ?? "", actions: pendingActions });
      }

      if (choice.finish_reason === "tool_calls") {
        // Append assistant message with tool_calls
        chatMessages.push(msg);

        // Execute each tool and append tool-result messages
        for (const tc of msg.tool_calls) {
          let input = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* malformed */ }

          const result = executeTool(tc.function.name, input);

          if (tc.function.name === "navigate_to_room" && result.navigating) {
            pendingActions.push({ type: "navigate_room", room_id: result.room_id });
          }

          chatMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      // Unexpected finish reason
      return res.json({ reply: msg.content ?? "(no response)", actions: pendingActions });
    }

    return res.json({ reply: "I reached the tool-call limit. Please try a simpler question.", actions: [] });
  } catch (err) {
    console.error("Chat API error:", err.message);
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true, rooms: rooms.length, appliances: appliances.length }));

const PORT = process.env.CHAT_PORT ?? 3001;
app.listen(PORT, () => console.log(`🏠 Bram House chat API → http://localhost:${PORT}`));
