"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const port = Number(process.env.DEMO_SITE_PORT || 4173);
const root = __dirname;
const server = http.createServer((request, response) => {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const extension = path.extname(file);
  const contentType =
    extension === ".html"
      ? "text/html; charset=utf-8"
      : "text/plain; charset=utf-8";
  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(file).pipe(response);
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Demo site running at http://127.0.0.1:${port}`),
);
