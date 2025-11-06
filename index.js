const COOLDOWN_MS = 60 * 60 * 1000; // 1 Stunde

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
      for (const key of keys.keys) {
        const value = await env.PIXEL_STORE.get(key.name);
        state[key.name] = value;
      }
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
      const key = x + "," + y;
      await env.PIXEL_STORE.put(key, color);
      await env.USER_LOG.put(userId, Date.now().toString());
      return new Response("OK");
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
  return `
<!DOCTYPE html>
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
    #colorPicker {
      width: 40px;
      height: 40px;
      border: none;
      cursor: pointer;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(50, var(--pixel-size));
      gap: var(--gap-size);
      background: #ccc;
      padding: var(--gap-size);
      border-radius: 8px;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
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
    @media (max-width: 600px) {
      .grid {
        transform: scale(0.8);
        transform-origin: top center;
      }
    }
  </style>
</head>
<body>
  <h1>🎨 r/place mini</h1>
  <div class="controls">
    <label for="colorPicker">Farbe wählen:</label>
    <input type="color" id="colorPicker" value="#ff0000" />
  </div>
  <div class="grid" id="grid"></div>
  <p id="status">Lade Pixel...</p>

  <script>
    const grid = document.getElementById("grid");
    const colorPicker = document.getElementById("colorPicker");
    const status = document.getElementById("status");

    async function loadGrid() {
      try {
        const res = await fetch("/state");
        const state = await res.json();
        grid.innerHTML = "";
        for (let y = 0; y < 50; y++) {
          for (let x = 0; x < 50; x++) {
            const div = document.createElement("div");
            div.className = "pixel";
            const key = x + "," + y;
            div.style.background = state[key] || getDefaultColor();
            div.onclick = async () => {
              const color = colorPicker.value;
              const resp = await fetch("/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ x, y, color }),
              });
              if (resp.status === 403) {
                status.textContent = "⏳ Du musst 1 Stunde warten!";
              } else {
                status.textContent = "✅ Pixel gesetzt!";
                div.style.background = color;
              }
            };
            grid.appendChild(div);
          }
        }
        status.textContent = "🟢 Pixel geladen";
      } catch (err) {
        status.textContent = "⚠️ Fehler beim Laden der Pixel";
      }
    }

    function getDefaultColor() {
      return getComputedStyle(document.documentElement).getPropertyValue('--default-color');
    }

    loadGrid();
    setInterval(loadGrid, 5000); // Polling alle 5 Sekunden
  </script>
</body>
</html>
`;
}
