export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/") {
      return new Response(await renderHTML(env), {
        headers: { "content-type": "text/html" },
      });
    }

    if (request.method === "POST" && pathname === "/update") {
      const { x, y, color } = await request.json();
      await env.PIXEL_STORE.put(`${x},${y}`, color);
      return new Response("OK");
    }

    if (request.method === "GET" && pathname === "/state") {
      const keys = await env.PIXEL_STORE.list();
      const state = {};
      for (const key of keys.keys) {
        state[key.name] = await env.PIXEL_STORE.get(key.name);
      }
      return new Response(JSON.stringify(state), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function renderHTML(env) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Mini r/place</title>
  <style>
    body { font-family: sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(50, 10px); gap: 1px; }
    .pixel { width: 10px; height: 10px; background: #eee; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Mini r/place</h1>
  <input type="color" id="colorPicker" value="#ff0000" />
  <div class="grid" id="grid"></div>

  <script>
    const grid = document.getElementById("grid");
    const colorPicker = document.getElementById("colorPicker");

    async function loadGrid() {
      const res = await fetch("/state");
      const state = await res.json();
      for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
          const div = document.createElement("div");
          div.className = "pixel";
          const key = \`\${x},\${y}\`;
          div.style.background = state[key] || "#eee";
          div.onclick = async () => {
            const color = colorPicker.value;
            div.style.background = color;
            await fetch("/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ x, y, color }),
            });
          };
          grid.appendChild(div);
        }
      }
    }

    loadGrid();
  </script>
</body>
</html>
`;
}
