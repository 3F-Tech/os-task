'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = parseInt(process.env.PORT ?? '8094', 10)
const STORE_PATH = process.env.STORE_PATH ?? '/data/store.json'

const store = new Map()

// Why: hulykvs guarda syncTokens e watch channels do calendar service. Sem
// persistir em disco, restart do container apagava esse estado e quebrava o
// sync incremental do Google (showDeleted=false sem syncToken).
function loadStore () {
  try {
    if (!fs.existsSync(STORE_PATH)) return
    const raw = fs.readFileSync(STORE_PATH, 'utf8')
    if (raw.length === 0) return
    const obj = JSON.parse(raw)
    for (const [k, v] of Object.entries(obj)) {
      store.set(k, v)
    }
    console.log(`hulykvs loaded ${store.size} keys from ${STORE_PATH}`)
  } catch (err) {
    console.error(`hulykvs failed to load ${STORE_PATH}, starting empty:`, err.message)
  }
}

let saveTimer = null
let savePending = false
function scheduleSave () {
  if (saveTimer != null) {
    savePending = true
    return
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    const wasPending = savePending
    savePending = false
    writeStoreSync()
    if (wasPending) scheduleSave()
  }, 200)
}

function writeStoreSync () {
  try {
    const dir = path.dirname(STORE_PATH)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = STORE_PATH + '.tmp'
    const data = JSON.stringify(Object.fromEntries(store))
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, STORE_PATH)
  } catch (err) {
    console.error('hulykvs failed to persist store:', err.message)
  }
}

loadStore()

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
        scheduleSave()
        res.writeHead(204)
        res.end()
      } else if (req.method === 'DELETE' && key !== undefined) {
        store.delete(`${namespace}:${key}`)
        scheduleSave()
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

// Why: flush imediato no shutdown para não perder writes ainda no buffer do
// debounce (200ms).
function shutdown () {
  if (saveTimer != null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  writeStoreSync()
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(PORT, () => {
  console.log(`hulykvs started on port ${PORT}, storing at ${STORE_PATH}`)
})
