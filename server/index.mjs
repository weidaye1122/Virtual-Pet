import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const staticDir = resolve(process.env.STATIC_DIR || join(projectRoot, 'dist'))
const dataFile = resolve(process.env.PET_DATA_FILE || join(projectRoot, 'data', 'pet-state.json'))
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '0.0.0.0'
const maxBodyBytes = 10 * 1024 * 1024

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

const send = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(body)
}

const sendJson = (response, statusCode, payload) => {
  send(response, statusCode, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
  })
}

const ensureDataDir = async () => {
  await mkdir(dirname(dataFile), { recursive: true })
}

const isInsideDirectory = (parentPath, childPath) => {
  const relativePath = relative(parentPath, childPath)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

const getStaticCacheControl = (filePath) => {
  if (extname(filePath) === '.html' || filePath.endsWith('/app-version.json')) {
    return 'no-store'
  }

  return filePath.includes('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300'
}

const formatHostForUrl = (value) => {
  if (value === '0.0.0.0') {
    return '127.0.0.1'
  }

  if (value === '::') {
    return '[::1]'
  }

  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value
}

const readRequestBody = async (request) =>
  new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let totalBytes = 0

    request.on('data', (chunk) => {
      totalBytes += chunk.length

      if (totalBytes > maxBodyBytes) {
        rejectBody(new Error('body_too_large'))
        request.destroy()
        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => {
      resolveBody(Buffer.concat(chunks).toString('utf8'))
    })

    request.on('error', rejectBody)
  })

const handleStateRequest = async (request, response) => {
  if (request.method === 'GET') {
    try {
      const raw = await readFile(dataFile, 'utf8')
      send(response, 200, raw, {
        'Content-Type': 'application/json; charset=utf-8',
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        sendJson(response, 404, { message: 'state_not_found' })
        return
      }

      sendJson(response, 500, { message: 'state_read_failed' })
    }

    return
  }

  if (request.method === 'PUT') {
    try {
      const rawBody = await readRequestBody(request)
      const parsedBody = JSON.parse(rawBody || '{}')
      await ensureDataDir()
      await writeFile(dataFile, `${JSON.stringify(parsedBody, null, 2)}\n`, 'utf8')
      sendJson(response, 200, { ok: true })
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { message: 'invalid_json' })
        return
      }

      if (error instanceof Error && error.message === 'body_too_large') {
        sendJson(response, 413, { message: 'body_too_large' })
        return
      }

      sendJson(response, 500, { message: 'state_write_failed' })
    }

    return
  }

  if (request.method === 'DELETE') {
    try {
      await rm(dataFile, { force: true })
      sendJson(response, 200, { ok: true })
    } catch {
      sendJson(response, 500, { message: 'state_delete_failed' })
    }

    return
  }

  sendJson(response, 405, { message: 'method_not_allowed' })
}

const serveStaticFile = async (requestPath, response) => {
  let decodedRequestPath = requestPath

  try {
    decodedRequestPath = decodeURIComponent(requestPath)
  } catch {
    sendJson(response, 400, { message: 'invalid_request_path' })
    return
  }

  const safeRelativePath =
    decodedRequestPath === '/' ? 'index.html' : decodedRequestPath.replace(/^\/+/, '')
  const filePath = resolve(staticDir, safeRelativePath)

  if (!isInsideDirectory(staticDir, filePath)) {
    sendJson(response, 403, { message: 'forbidden' })
    return
  }

  try {
    const currentStat = await stat(filePath)

    if (currentStat.isDirectory()) {
      const indexPath = join(filePath, 'index.html')
      const indexBuffer = await readFile(indexPath)
      send(response, 200, indexBuffer, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      })
      return
    }

    const content = await readFile(filePath)
    const mimeType = mimeTypes[extname(filePath)] || 'application/octet-stream'
    send(response, 200, content, {
      'Cache-Control': getStaticCacheControl(filePath),
      'Content-Type': mimeType,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      if (extname(safeRelativePath)) {
        sendJson(response, 404, { message: 'static_asset_not_found' })
        return
      }

      try {
        const indexHtml = await readFile(join(staticDir, 'index.html'))
        send(response, 200, indexHtml, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8',
        })
      } catch {
        sendJson(response, 404, { message: 'static_asset_not_found' })
      }

      return
    }

    sendJson(response, 500, { message: 'static_asset_failed' })
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { message: 'bad_request' })
    return
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Origin': '*',
    })
    response.end()
    return
  }

  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (requestUrl.pathname === '/api/state') {
    await handleStateRequest(request, response)
    return
  }

  await serveStaticFile(requestUrl.pathname, response)
})

server.on('error', (error) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
    console.error(`port ${port} is already in use on ${host}`)
    process.exit(1)
  }

  throw error
})

server.listen(port, host, () => {
  console.log(`pet storage server listening on http://${formatHostForUrl(host)}:${port}`)
  console.log(`persisting app state to ${dataFile}`)
})
