import { createServer } from 'node:http';

const { API_PORT, API_HOST, API_PROTOCOL } = process.env

type Post = {
  id: number
  title: string
  content: string
}

const posts: Post[] = []

const server = createServer((req, res) => {
  const { url, method } = req
  const paths = url?.split("?").filter(Boolean)
  const path = paths?.at(0) || "/"

  if (path === "/posts" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" })
    return res.end(JSON.stringify({ data: posts }))
  }

  if (path === "/posts" && method === "POST") {
    const bodyBuffer: Buffer[] = []

    // Armazena o corpo da requisição em um array
    req.on("data", (chunk: Buffer) => bodyBuffer.push(chunk))
    req.on("end", () => {
      const bodyString = Buffer.concat(bodyBuffer).toString()
      const body: unknown = JSON.parse(bodyString)

      res.writeHead(201, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ message: "Post created", body }))
    })

    return
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  return res.end(JSON.stringify({ message: "Not Found" }))
});

server.listen(Number(API_PORT ?? 8080), API_HOST, () => {
  console.log(`Server running on ${API_PROTOCOL}://${API_HOST}:${API_PORT}`)
  console.log("Press CTRL+C to stop")
})
