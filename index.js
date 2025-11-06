const COOLDOWN_MS =  1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const userId = getUserId(request);

    if (request.method === "GET" && path === "/") {
      return new Response(await renderHTML(), {
        headers: { "content-type": "text/html" },
      });
    }

    if (request.method === "GET" && path === "/state") {
      const keys = await env.PIXEL_STORE.list();
      const state = {};
      for (const key of keys.keys) {
        state[key.name] = await env.PIXEL_STORE.get(key.name);
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
      await env.PIXEL_STORE.put(`${x},${y}`, color);
      await env.USER_LOG.put(userId, Date.now().toString());
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
};

function getUserId(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return `user-${ip}`;
}

async function canUserPaint(env, userId) {
  const last = await env.USER_LOG.get(userId);
  if (!last) return true;
  return Date.now() - parseInt(last) > COOLDOWN_MS;
}

function renderHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>r/place mini</title>
  <style>
    body { font-family: sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(50, 10px); gap: 1px; }
    .pixel { width: 10px; height: 10px; background: #eee; cursor: pointer; }
  </style>
</head>
<body>
  <h1>r/place mini</h1>
  <input type="color" id="colorPicker" value="#ff0000" />
  <div class="grid" id="grid"></div>
  <p id="status"></p>

  <script>
    const grid = document.getElementById("grid");
    const colorPicker = document.getElementById("colorPicker");
    const status = document.getElementById("status");

    async function loadGrid() {
      const res = await fetch("/state");
      const state = await res.json();
      grid.innerHTML = "";
      for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
          const div = document.createElement("div");
          div.className = "pixel";
          const key = \`\${x},\${y}\`;
          div.style.background = state[key] || "#eee";
          div.onclick = async () => {
            const color = colorPicker.value;
            const resp = await fetch("/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ x, y, color }),
            });
            if (resp.status === 403) {
              status.textContent = "Du musst 1 Stunde warten!";
            } else {
              status.textContent = "Pixel gesetzt!";
              div.style.background = color;
            }
          };
          grid.appendChild(div);
        }
      }
    }

    loadGrid();
    setInterval(loadGrid, 5000); // Polling alle 5 Sekunden
  </script>
</body>
</html>
`;
}
