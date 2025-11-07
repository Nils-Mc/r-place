const COOLDOWN_MS = 10; // 1 Minute
const clients = new Set();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const userId = getUserId(request);

    if (request.method === "GET" && path === "/") {
      return new Response(renderHTML(), {
        headers: { "content-type": "text/html" },
      });
    }

    if (request.method === "GET" && path === "/state") {
      const keys = await env.PIXEL_STORE.list();
      const state = {};
      await Promise.all(keys.keys.map(async (key) => {
        const value = await env.PIXEL_STORE.get(key.name);
        state[key.name] = value;
      }));
      return new Response(JSON.stringify(state), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "POST" && path === "/update") {
      const { x, y, color } = await request.json();
      const allowed = await canUserPaint(env, userId);
      if (!allowed) {
        return new Response("Cooldown active", { status: 403 });
      }

      const key = `${x},${y}`;
      await env.PIXEL_STORE.put(key, color);
      await env.USER_LOG.put(userId, Date.now().toString());

      const payload = JSON.stringify({ x, y, color });
      for (const client of clients) {
        client.write(`data: ${payload}\n\n`);
      }

      return new Response("OK");
    }

    if (request.method === "GET" && path === "/events") {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const writer = {
            write: (msg) => controller.enqueue(encoder.encode(msg)),
            close: () => controller.close(),
          };
          clients.add(writer);
          request.signal.addEventListener("abort", () => {
            clients.delete(writer);
            writer.close();
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

function getUserId(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return "user-" + ip;
}

async function canUserPaint(env, userId) {
  const last = await env.USER_LOG.get(userId);
  if (!last) return true;
  return Date.now() - parseInt(last) > COOLDOWN_MS;
}

function renderHTML() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>r/place mini</title>
  <style>
    :root {
      --pixel-size: 12px;
      --gap-size: 1px;
      --default-color: #eee;
    }
    body {
      margin: 0;
      font-family: 'Segoe UI', sans-serif;
      background: #f4f4f4;
      color: #333;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1rem;
    }
    h1 {
      margin-bottom: 0.5rem;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    #colorPicker, #zoomIn, #zoomOut {
      width: 40px;
      height: 40px;
      border: none;
      cursor: pointer;
    }
    #nameInput {
      padding: 0.3rem;
      font-size: 1rem;
    }
    .grid-wrapper {
      overflow: auto;
      max-width: 100vw;
      max-height: 80vh;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(100, var(--pixel-size));
      gap: var(--gap-size);
      background: #ccc;
      padding: var(--gap-size);
      border-radius: 8px;
      transform-origin: top left;
    }
    .pixel {
      width: var(--pixel-size);
      height: var(--pixel-size);
      background: var(--default-color);
      cursor: pointer;
      transition: transform 0.1s ease;
    }
    .pixel:hover {
      transform: scale(1.2);
      outline: 1px solid #999;
    }
    #status {
      margin-top: 1rem;
      font-size: 0.9rem;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>🎨 Platziere deine Pixel</h1>
  <div class="controls">
    <label for="nameInput">Name:</label>
    <input type="text" id="nameInput" placeholder="Dein Name" />
    <input type="color" id="colorPicker" value="#ff0000" />
    <button id="zoomIn">➕</button>
    <button id="zoomOut">➖</button>
  </div>
  <div class="grid-wrapper">
    <div class="grid" id="grid"></div>
  </div>
  <p id="status">Lade Pixel...</p>
  <p>Bei Fehlern bitte eine Mail an <a href="mailto:Nils_1132@gmx.de">Nils_1132@gmx.de</a></p>

  <script>
    const grid = document.getElementById("grid");
    const colorPicker = document.getElementById("colorPicker");
    const nameInput = document.getElementById("nameInput");
    const status = document.getElementById("status");
    const zoomIn = document.getElementById("zoomIn");
    const zoomOut = document.getElementById("zoomOut");

    const GRID_WIDTH = 100;
    const GRID_HEIGHT = 100;
    let zoomLevel = 1;

    nameInput.value = localStorage.getItem("username") || "";
    colorPicker.value = localStorage.getItem("color") || "#ff0000";

    nameInput.oninput = () => localStorage.setItem("username", nameInput.value);
    colorPicker.oninput = () => localStorage.setItem("color", colorPicker.value);

    zoomIn.onclick = () => {
      zoomLevel = Math.min(zoomLevel + 0.1, 2);
      grid.style.transform = \`scale(\${zoomLevel})\`;
    };
    zoomOut.onclick = () => {
      zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
      grid.style.transform = \`scale(\${zoomLevel})\`;
    };

    function getDefaultColor() {
      return getComputedStyle(document.documentElement).getPropertyValue('--default-color');
    }

    function createGrid() {
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const div = document.createElement("div");
          const key = x + "," + y;
          div.className = "pixel";
          div.id = "px-" + key;
          div.style.background = getDefaultColor();
          div.onclick = () => placePixel(x, y, div);
          grid.appendChild(div);
        }
      }
    }

    async function loadGrid() {
      try {
        const res = await fetch("/state");
        const state = await res.json();
        for (const key in state) {
          const pixel = document.getElementById("px-" + key);
          if (pixel) {
            pixel.style.background = state[key];
          }
        }
        status.textContent = "🟢 Pixel geladen";
      } catch (err) {
        status.textContent = "⚠️ Fehler beim Laden der Pixel";
      }
    }

    async function placePixel(x, y, div) {
      const color = colorPicker.value;
      const name = nameInput.value;
      const resp = await fetch("/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y, color, name }),
      });
      if (resp.status === 403) {
        status.textContent = "⏳ Du musst 1 Minute warten!";
      } else {
        status.textContent = "✅ Pixel gesetzt!";
        div.style.background = color;
      }
    }

    const eventSource = new EventSource("/events");
    eventSource.onmessage = (event) => {
      const { x, y, color } = JSON.parse(event.data);
      const pixel = document.getElementById("px-" + x + "," + y);
      if (pixel) pixel.style.background = color;
    };

    createGrid();
    loadGrid();
  </script>
</body>
</html>`;
}
