import { createServer } from 'node:http';

const { API_PORT, API_HOST, API_PROTOCOL } = process.env

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Hello World');
});

server.listen(Number(API_PORT ?? 8080), API_HOST, () => {
  console.log(`Server running on ${API_PROTOCOL}://${API_HOST}:${API_PORT}`)
  console.log("Press CTRL+C to stop")
})
