import { createServer } from 'node:http';

const PORT = 8080;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Hello World');
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
