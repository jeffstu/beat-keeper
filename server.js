const http = require("http");
const fs = require("fs").promises;
const path = require("path");

const port = process.env.PORT || 3000;
const root = __dirname;
const dataFile = path.join(root, "leaderboard.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

async function readLeaderboard() {
  try {
    const data = await fs.readFile(dataFile, "utf8");
    return JSON.parse(data || "[]");
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(dataFile, "[]", "utf8");
      return [];
    }
    throw error;
  }
}

async function writeLeaderboard(entries) {
  await fs.writeFile(dataFile, JSON.stringify(entries, null, 2), "utf8");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function serveStatic(res, filePath) {
  try {
    const ext = path.extname(filePath) || ".html";
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/leaderboard" || url.pathname === "/leaderboard.php") {
    if (req.method === "GET") {
      try {
        const entries = await readLeaderboard();
        return sendJson(res, 200, entries);
      } catch {
        return sendJson(res, 500, { error: "Unable to read leaderboard" });
      }
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const entries = JSON.parse(body);
          if (!Array.isArray(entries)) throw new Error("Expected array");
          await writeLeaderboard(entries);
          return sendJson(res, 200, { ok: true });
        } catch {
          return sendJson(res, 400, { error: "Invalid leaderboard payload" });
        }
      });
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  let filePath = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  if (!path.extname(filePath)) {
    filePath = path.join(filePath, "index.html");
  }

  return serveStatic(res, filePath);
});

server.listen(port, () => {
  console.log(`Beat Keeper server running at http://localhost:${port}`);
});
