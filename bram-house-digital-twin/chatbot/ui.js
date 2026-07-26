// Building Assistant UI — lives in /chatbot with the OpenAI API server.
import "./chat.css";
import { enterRoom } from "../src/interaction/roomActions.js";

const STORAGE_KEY = "twinlink_chat_history_v1"; // legacy key — cleared on load
const TEASER_DISMISS_KEY = "twinlink_chat_teaser_dismissed_v1";
const MAX_MESSAGES = 40;

const TEASER_LINES = [
  "We have a building chatbot",
  "Ask AI about rooms & air quality",
  "Try: “Show me the kitchen”",
  "Energy questions? Ask AI",
];

let panelOpen = false;
let messages = [];   // { role: "user"|"assistant", content: string }
let thinking = false;
let teaserTimer = null;
let teaserLineIndex = 0;

// ── Bootstrap ───────────────────────────────────────────────────────────────
export function initChatbot() {
  injectHTML();
  clearPersistedHistory();
  wireEvents();
  renderMessages();
  startTeaser();
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
function q(sel) { return document.querySelector(sel); }

function injectHTML() {
  // Chat toggle button added to the bottom toolbar
  const toolbar = document.getElementById("toolbar");
  if (toolbar) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btnChat";
    btn.className = "tbtn tbtn-sm";
    btn.title = "Ask the building assistant";
    btn.textContent = "💬 Ask AI";
    toolbar.querySelector(".dock-group.dock-compact:last-of-type")?.appendChild(btn);
  }

  // Chat panel (floats above the viewer stage)
  const panel = document.createElement("div");
  panel.id = "chatPanel";
  panel.className = "chat-panel";
  panel.setAttribute("aria-label", "Building AI assistant");
  panel.innerHTML = `
    <div class="chat-header">
      <span class="chat-title">🏠 Building Assistant</span>
      <span class="chat-sub muted">Powered by OpenAI + building data tools</span>
      <button type="button" class="chat-close" id="chatClose" aria-label="Close chat">✕</button>
    </div>
    <div class="chat-messages" id="chatMessages" role="log" aria-live="polite"></div>
    <div class="chat-input-row">
      <input
        type="text"
        id="chatInput"
        class="chat-input"
        placeholder="Ask about rooms, energy, air quality…"
        autocomplete="off"
        aria-label="Chat message"
        maxlength="400"
      />
      <button type="button" id="chatSend" class="tbtn chat-send" aria-label="Send">↑</button>
    </div>
    <p class="chat-hint muted">Try: "What rooms have poor air quality?" · "Show me the kitchen" · "How much energy did we use?"</p>
  `;

  // Teaser alert above Ask AI — cycling flicker messages
  const teaser = document.createElement("div");
  teaser.id = "chatTeaser";
  teaser.className = "chat-teaser";
  teaser.setAttribute("role", "status");
  teaser.innerHTML = `
    <button type="button" class="chat-teaser-main" id="chatTeaserOpen" aria-label="Open building chatbot">
      <span class="chat-teaser-pulse" aria-hidden="true"></span>
      <span class="chat-teaser-text" id="chatTeaserText">${TEASER_LINES[0]}</span>
    </button>
    <button type="button" class="chat-teaser-dismiss" id="chatTeaserDismiss" aria-label="Dismiss tip">✕</button>
  `;

  // Insert into the viewer stage so it floats above the 3D view
  const stage = document.getElementById("viewerStage");
  if (stage) {
    stage.appendChild(panel);
    stage.appendChild(teaser);
  }
}

// ── Events ───────────────────────────────────────────────────────────────────
function wireEvents() {
  document.getElementById("btnChat")?.addEventListener("click", togglePanel);
  document.getElementById("chatClose")?.addEventListener("click", () => setOpen(false));
  document.getElementById("chatTeaserOpen")?.addEventListener("click", () => setOpen(true));
  document.getElementById("chatTeaserDismiss")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissTeaser(true);
  });

  const input = q("#chatInput");
  document.getElementById("chatSend")?.addEventListener("click", sendMessage);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

function togglePanel() { setOpen(!panelOpen); }

function setOpen(open) {
  panelOpen = open;
  q("#chatPanel")?.classList.toggle("open", open);
  document.getElementById("btnChat")?.classList.toggle("active", open);
  if (open) {
    dismissTeaser(false);
    q("#chatInput")?.focus();
    scrollToBottom();
  }
}

// ── Teaser alert (cycling messages near Ask AI) ──────────────────────────────
function startTeaser() {
  if (sessionStorage.getItem(TEASER_DISMISS_KEY) === "1") return;
  const el = document.getElementById("chatTeaser");
  if (!el) return;

  // Appear shortly after load so it feels like an alert
  setTimeout(() => {
    if (panelOpen || sessionStorage.getItem(TEASER_DISMISS_KEY) === "1") return;
    el.classList.add("visible");
    cycleTeaserLine(true);
    teaserTimer = setInterval(() => cycleTeaserLine(false), 2800);
  }, 1800);
}

function cycleTeaserLine(immediate) {
  const textEl = document.getElementById("chatTeaserText");
  const el = document.getElementById("chatTeaser");
  if (!textEl || !el?.classList.contains("visible")) return;

  const next = () => {
    teaserLineIndex = (teaserLineIndex + 1) % TEASER_LINES.length;
    textEl.textContent = TEASER_LINES[teaserLineIndex];
    textEl.classList.remove("flicker-out");
    textEl.classList.add("flicker-in");
  };

  if (immediate) {
    textEl.textContent = TEASER_LINES[teaserLineIndex];
    textEl.classList.add("flicker-in");
    return;
  }

  textEl.classList.remove("flicker-in");
  textEl.classList.add("flicker-out");
  setTimeout(next, 220);
}

function dismissTeaser(persist) {
  const el = document.getElementById("chatTeaser");
  el?.classList.remove("visible");
  el?.classList.add("hidden");
  if (teaserTimer) {
    clearInterval(teaserTimer);
    teaserTimer = null;
  }
  if (persist) {
    try { sessionStorage.setItem(TEASER_DISMISS_KEY, "1"); } catch { /* ignore */ }
  }
}

// ── Messaging ────────────────────────────────────────────────────────────────
async function sendMessage() {
  if (thinking) return;
  const input = q("#chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  pushMessage("user", text);
  renderMessages();
  setThinking(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 404 || res.status === 502 || res.status === 504) {
        throw new Error("Chat API is offline. Run npm run dev (starts Vite + API on port 3001).");
      }
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.reply) pushMessage("assistant", data.reply);

    // Execute any 3D-view actions returned by the tool loop
    if (Array.isArray(data.actions)) {
      for (const action of data.actions) {
        if (action.type === "navigate_room" && action.room_id) {
          // Give the panel a moment before flying
          setTimeout(() => enterRoom(action.room_id), 400);
        }
      }
    }
  } catch (err) {
    pushMessage("assistant", `⚠️ ${err.message}`);
  } finally {
    setThinking(false);
    renderMessages();
    scrollToBottom();
  }
}

function pushMessage(role, content) {
  messages.push({ role, content });
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderMessages() {
  const el = document.getElementById("chatMessages");
  if (!el) return;

  if (messages.length === 0) {
    el.innerHTML = `<p class="chat-empty muted">Ask me anything about the building — rooms, energy, air quality, or appliances.</p>`;
    return;
  }

  el.innerHTML = messages.map((m) => {
    const cls = m.role === "user" ? "chat-msg-user" : "chat-msg-bot";
    const escaped = escapeHTML(m.content);
    // Convert newlines to <br> and bold **text**
    const formatted = escaped
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return `<div class="chat-msg ${cls}">${formatted}</div>`;
  }).join("");

  if (thinking) {
    el.innerHTML += `<div class="chat-msg chat-msg-bot chat-thinking"><span></span><span></span><span></span></div>`;
  }

  scrollToBottom();
}

function setThinking(val) {
  thinking = val;
  const send = document.getElementById("chatSend");
  const input = q("#chatInput");
  if (send) send.disabled = val;
  if (input) input.disabled = val;
  renderMessages();
}

function scrollToBottom() {
  const el = document.getElementById("chatMessages");
  if (el) el.scrollTop = el.scrollHeight;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Session only (no history across reloads) ─────────────────────────────────
function clearPersistedHistory() {
  messages = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
