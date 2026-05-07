'use strict'

const http = require('http')
const store = new Map()

const PORT = parseInt(process.env.PORT ?? '8094', 10)

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const parts = url.pathname.split('/').filter(Boolean)

  if (parts[0] !== 'api' || parts[1] === undefined) {
    res.writeHead(400)
    res.end()
    return
  }

  const namespace = decodeURIComponent(parts[1])
  const key = parts[2] !== undefined ? decodeURIComponent(parts[2]) : undefined

  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    try {
      if (req.method === 'GET' && key !== undefined) {
        const val = store.get(`${namespace}:${key}`)
        if (val === undefined) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end('null')
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(val))
        }
      } else if (req.method === 'POST' && key !== undefined) {
        store.set(`${namespace}:${key}`, JSON.parse(body))
        res.writeHead(204)
        res.end()
      } else if (req.method === 'DELETE' && key !== undefined) {
        store.delete(`${namespace}:${key}`)
        res.writeHead(204)
        res.end()
      } else if (req.method === 'GET' && key === undefined) {
        const prefix = url.searchParams.get('prefix') ?? namespace
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ keys }))
      } else {
        res.writeHead(405)
        res.end()
      }
    } catch (err) {
      res.writeHead(500)
      res.end(String(err))
    }
  })
})

server.listen(PORT, () => {
  console.log(`hulykvs started on port ${PORT}`)
})
