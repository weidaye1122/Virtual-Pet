import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
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
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024)
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000)
const sessionCookieName = 'pet_session'
const csrfHeaderName = 'x-csrf-token'
const requestedWithHeaderValue = 'fetch'
const secureSessionCookie = process.env.SESSION_COOKIE_SECURE === 'true'
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || process.env.PUBLIC_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const sessions = new Map()
const loginAttempts = new Map()

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

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join('; '),
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

const send = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    ...securityHeaders,
    ...headers,
  })
  response.end(body)
}

const sendJson = (response, statusCode, payload, headers = {}) => {
  send(response, statusCode, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
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

const getHeaderValue = (request, name) => {
  const value = request.headers[name.toLowerCase()]

  return Array.isArray(value) ? value[0] : value || ''
}

const parseCookies = (request) => {
  const cookieHeader = getHeaderValue(request, 'cookie')

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf('=')

        if (separatorIndex === -1) {
          return [part, '']
        }

        return [
          decodeURIComponent(part.slice(0, separatorIndex)),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ]
      }),
  )
}

const serializeCookie = (name, value, options = {}) => {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
  ]

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  }

  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  if (secureSessionCookie) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

const createToken = () => randomBytes(32).toString('base64url')

const pruneExpiredSessions = () => {
  const now = Date.now()

  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId)
    }
  }
}

const createSession = () => {
  pruneExpiredSessions()

  const sessionId = createToken()
  const session = {
    csrfToken: createToken(),
    expiresAt: Date.now() + sessionTtlMs,
  }

  sessions.set(sessionId, session)

  return { session, sessionId }
}

const getSession = (request) => {
  pruneExpiredSessions()

  const sessionId = parseCookies(request)[sessionCookieName]

  if (!sessionId) {
    return null
  }

  const session = sessions.get(sessionId)

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId)
    return null
  }

  return { session, sessionId }
}

const createSessionHeaders = (sessionId) => ({
  'Set-Cookie': serializeCookie(sessionCookieName, sessionId, {
    httpOnly: true,
    maxAge: Math.ceil(sessionTtlMs / 1000),
  }),
})

const createExpiredSessionHeaders = () => ({
  'Set-Cookie': serializeCookie(sessionCookieName, '', {
    httpOnly: true,
    maxAge: 0,
  }),
})

const getConfiguredOriginsForRequest = (request) => {
  const origins = new Set(allowedOrigins)
  const hostHeader = getHeaderValue(request, 'host')
  const forwardedHost = getHeaderValue(request, 'x-forwarded-host')

  for (const currentHost of [hostHeader, forwardedHost].filter(Boolean)) {
    origins.add(`http://${currentHost}`)
    origins.add(`https://${currentHost}`)
  }

  return origins
}

const isAllowedOrigin = (request) => {
  const origin = getHeaderValue(request, 'origin')

  if (!origin) {
    return true
  }

  return getConfiguredOriginsForRequest(request).has(origin)
}

const getCorsHeaders = (request) => {
  const origin = getHeaderValue(request, 'origin')

  if (!origin || !isAllowedOrigin(request)) {
    return {}
  }

  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  }
}

const getClientKey = (request) => request.socket.remoteAddress || 'unknown'

const getLoginAttempt = (request) => {
  const key = getClientKey(request)
  const now = Date.now()
  const current = loginAttempts.get(key)

  if (!current || current.resetAt <= now) {
    const next = {
      count: 0,
      lockedUntil: 0,
      resetAt: now + 5 * 60 * 1000,
    }

    loginAttempts.set(key, next)
    return next
  }

  return current
}

const isLoginLimited = (request) => getLoginAttempt(request).lockedUntil > Date.now()

const recordLoginFailure = (request) => {
  const attempt = getLoginAttempt(request)
  attempt.count += 1

  if (attempt.count >= 8) {
    attempt.lockedUntil = Date.now() + 5 * 60 * 1000
  }
}

const clearLoginFailures = (request) => {
  loginAttempts.delete(getClientKey(request))
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

const isRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isBoundedString = (value, maxLength) =>
  typeof value === 'string' && value.length <= maxLength

const isBoundedNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const isStateWithPassword = (state) =>
  Boolean(
    isRecord(state) &&
      isRecord(state.meta) &&
      state.meta.passwordHash &&
      state.meta.passwordSalt,
  )

const isPasswordHash = (value) =>
  value === '' ||
  (typeof value === 'string' &&
    (/^sha256-[a-f0-9]{64}$/.test(value) || /^fallback-[a-f0-9]{8}$/.test(value)))

const isPasswordSalt = (value) =>
  value === '' || (typeof value === 'string' && /^[a-f0-9]{16,128}$/.test(value))

const isValidStringArray = (value, maxItems, maxStringLength) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => isBoundedString(item, maxStringLength))

const isValidTask = (task) =>
  isRecord(task) &&
  isBoundedString(task.id, 80) &&
  isBoundedString(task.title, 80) &&
  isBoundedString(task.icon, 16) &&
  isBoundedNumber(task.points) &&
  isBoundedNumber(task.growth) &&
  ['todo', 'done', 'claimed'].includes(task.status)

const isValidEffect = (effect) =>
  effect === undefined ||
  (isRecord(effect) &&
    ['hunger', 'mood', 'clean', 'energy'].every(
      (key) => effect[key] === undefined || isBoundedNumber(effect[key]),
    ))

const isValidShopItem = (item) =>
  isRecord(item) &&
  isBoundedString(item.id, 80) &&
  isBoundedString(item.name, 80) &&
  isBoundedString(item.icon, 32) &&
  ['food', 'toy', 'care', 'clothing', 'background', 'effect'].includes(item.type) &&
  isBoundedNumber(item.price) &&
  typeof item.owned === 'boolean' &&
  isBoundedString(item.description, 240) &&
  (item.wearableSlot === undefined || ['hat', 'scarf', 'shoes'].includes(item.wearableSlot)) &&
  isValidEffect(item.effect)

const isValidInventory = (inventory) =>
  isRecord(inventory) &&
  isValidStringArray(inventory.ownedItemIds, 500, 80) &&
  isRecord(inventory.consumables) &&
  Object.entries(inventory.consumables).length <= 500 &&
  Object.entries(inventory.consumables).every(
    ([key, value]) =>
      isBoundedString(key, 80) &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 9999,
  )

const isValidMeta = (meta) =>
  isRecord(meta) &&
  isBoundedString(meta.userName ?? '', 80) &&
  isPasswordHash(meta.passwordHash ?? '') &&
  isPasswordSalt(meta.passwordSalt ?? '') &&
  isBoundedString(meta.profileAvatar ?? '', 2_000_000)

const isValidPersistedState = (value) =>
  isRecord(value) &&
  isRecord(value.pet) &&
  Array.isArray(value.tasks) &&
  value.tasks.length <= 300 &&
  value.tasks.every(isValidTask) &&
  Array.isArray(value.shopItems) &&
  value.shopItems.length <= 600 &&
  value.shopItems.every(isValidShopItem) &&
  isValidInventory(value.inventory) &&
  Array.isArray(value.pointRecords) &&
  value.pointRecords.length <= 300 &&
  isValidMeta(value.meta)

const readPersistedState = async () => {
  const raw = await readFile(dataFile, 'utf8')
  const parsed = JSON.parse(raw)

  if (!isValidPersistedState(parsed)) {
    throw new Error('invalid_persisted_state')
  }

  return parsed
}

const readPersistedStateOrNull = async () => {
  try {
    return await readPersistedState()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

const normalizeNumericPassword = (value) => value.replace(/\D/g, '').slice(0, 12)

const fallbackHash = (value) => {
  let hash = 0x811c9dc5

  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }

  return `fallback-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

const hashNumericPassword = (password, salt, prefix = 'sha256') => {
  const payload = `${salt}:${normalizeNumericPassword(password)}`

  if (prefix === 'fallback') {
    return fallbackHash(payload)
  }

  return `sha256-${createHash('sha256').update(payload).digest('hex')}`
}

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const verifyPassword = (password, meta) => {
  if (!isPasswordHash(meta.passwordHash) || !isPasswordSalt(meta.passwordSalt)) {
    return false
  }

  const prefix = meta.passwordHash.startsWith('fallback-') ? 'fallback' : 'sha256'
  const passwordHash = hashNumericPassword(password, meta.passwordSalt, prefix)

  return safeEqual(passwordHash, meta.passwordHash)
}

const validateBrowserWriteRequest = (request, response) => {
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { message: 'origin_not_allowed' }, getCorsHeaders(request))
    return false
  }

  if (getHeaderValue(request, 'x-requested-with') !== requestedWithHeaderValue) {
    sendJson(response, 400, { message: 'missing_requested_with' }, getCorsHeaders(request))
    return false
  }

  return true
}

const validateCsrfToken = (request, session, response) => {
  const csrfToken = getHeaderValue(request, csrfHeaderName)

  if (!csrfToken || csrfToken !== session.csrfToken) {
    sendJson(response, 403, { message: 'invalid_csrf_token' }, getCorsHeaders(request))
    return false
  }

  return true
}

const handleSessionRequest = async (request, response) => {
  if (request.method === 'GET') {
    try {
      const state = await readPersistedStateOrNull()
      const activeSession = getSession(request)
      const hasPassword = isStateWithPassword(state)

      sendJson(response, 200, {
        authenticated: Boolean(activeSession),
        csrfToken: activeSession?.session.csrfToken ?? '',
        hasPassword,
        setupRequired: !hasPassword,
      }, getCorsHeaders(request))
    } catch {
      sendJson(response, 500, { message: 'session_status_failed' }, getCorsHeaders(request))
    }

    return
  }

  if (request.method === 'POST') {
    if (!validateBrowserWriteRequest(request, response)) {
      return
    }

    if (isLoginLimited(request)) {
      sendJson(response, 429, { message: 'too_many_attempts' }, getCorsHeaders(request))
      return
    }

    try {
      const state = await readPersistedStateOrNull()

      if (!isStateWithPassword(state)) {
        sendJson(response, 404, { message: 'setup_required' }, getCorsHeaders(request))
        return
      }

      const rawBody = await readRequestBody(request)
      const parsedBody = JSON.parse(rawBody || '{}')

      if (!isRecord(parsedBody) || !isBoundedString(parsedBody.password, 12)) {
        sendJson(response, 400, { message: 'invalid_login_payload' }, getCorsHeaders(request))
        return
      }

      if (!verifyPassword(parsedBody.password, state.meta)) {
        recordLoginFailure(request)
        sendJson(response, 401, { message: 'invalid_password' }, getCorsHeaders(request))
        return
      }

      clearLoginFailures(request)
      const { session, sessionId } = createSession()
      sendJson(response, 200, {
        authenticated: true,
        csrfToken: session.csrfToken,
        ok: true,
      }, {
        ...createSessionHeaders(sessionId),
        ...getCorsHeaders(request),
      })
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { message: 'invalid_json' }, getCorsHeaders(request))
        return
      }

      if (error instanceof Error && error.message === 'body_too_large') {
        sendJson(response, 413, { message: 'body_too_large' }, getCorsHeaders(request))
        return
      }

      sendJson(response, 500, { message: 'session_login_failed' }, getCorsHeaders(request))
    }

    return
  }

  if (request.method === 'DELETE') {
    if (!validateBrowserWriteRequest(request, response)) {
      return
    }

    const activeSession = getSession(request)

    if (activeSession) {
      if (!validateCsrfToken(request, activeSession.session, response)) {
        return
      }

      sessions.delete(activeSession.sessionId)
    }

    sendJson(response, 200, { ok: true }, {
      ...createExpiredSessionHeaders(),
      ...getCorsHeaders(request),
    })
    return
  }

  sendJson(response, 405, { message: 'method_not_allowed' }, getCorsHeaders(request))
}

const handleStateRequest = async (request, response) => {
  if (request.method === 'GET') {
    try {
      const state = await readPersistedStateOrNull()

      if (!state) {
        sendJson(response, 404, { message: 'state_not_found' }, getCorsHeaders(request))
        return
      }

      if (isStateWithPassword(state) && !getSession(request)) {
        sendJson(response, 401, { message: 'auth_required' }, getCorsHeaders(request))
        return
      }

      sendJson(response, 200, state, getCorsHeaders(request))
    } catch {
      sendJson(response, 500, { message: 'state_read_failed' }, getCorsHeaders(request))
    }

    return
  }

  if (request.method === 'PUT') {
    if (!validateBrowserWriteRequest(request, response)) {
      return
    }

    try {
      const existingState = await readPersistedStateOrNull()
      const activeSession = getSession(request)

      if (isStateWithPassword(existingState)) {
        if (!activeSession) {
          sendJson(response, 401, { message: 'auth_required' }, getCorsHeaders(request))
          return
        }

        if (!validateCsrfToken(request, activeSession.session, response)) {
          return
        }
      }

      const rawBody = await readRequestBody(request)
      const parsedBody = JSON.parse(rawBody || '{}')

      if (!isValidPersistedState(parsedBody)) {
        sendJson(response, 400, { message: 'invalid_state_payload' }, getCorsHeaders(request))
        return
      }

      if (!isStateWithPassword(existingState) && !isStateWithPassword(parsedBody)) {
        sendJson(response, 400, { message: 'setup_requires_password' }, getCorsHeaders(request))
        return
      }

      await ensureDataDir()
      await writeFile(dataFile, `${JSON.stringify(parsedBody, null, 2)}\n`, 'utf8')

      if (isStateWithPassword(parsedBody)) {
        const nextSession = activeSession ?? createSession()
        const headers = activeSession ? {} : createSessionHeaders(nextSession.sessionId)

        sendJson(response, 200, {
          csrfToken: nextSession.session.csrfToken,
          ok: true,
        }, {
          ...headers,
          ...getCorsHeaders(request),
        })
        return
      }

      if (activeSession) {
        sessions.delete(activeSession.sessionId)
      }

      sendJson(response, 200, { ok: true }, {
        ...createExpiredSessionHeaders(),
        ...getCorsHeaders(request),
      })
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { message: 'invalid_json' }, getCorsHeaders(request))
        return
      }

      if (error instanceof Error && error.message === 'body_too_large') {
        sendJson(response, 413, { message: 'body_too_large' }, getCorsHeaders(request))
        return
      }

      sendJson(response, 500, { message: 'state_write_failed' }, getCorsHeaders(request))
    }

    return
  }

  if (request.method === 'DELETE') {
    if (!validateBrowserWriteRequest(request, response)) {
      return
    }

    try {
      const existingState = await readPersistedStateOrNull()
      const activeSession = getSession(request)

      if (isStateWithPassword(existingState)) {
        if (!activeSession) {
          sendJson(response, 401, { message: 'auth_required' }, getCorsHeaders(request))
          return
        }

        if (!validateCsrfToken(request, activeSession.session, response)) {
          return
        }
      }

      await rm(dataFile, { force: true })

      if (activeSession) {
        sessions.delete(activeSession.sessionId)
      }

      sendJson(response, 200, { ok: true }, {
        ...createExpiredSessionHeaders(),
        ...getCorsHeaders(request),
      })
    } catch {
      sendJson(response, 500, { message: 'state_delete_failed' }, getCorsHeaders(request))
    }

    return
  }

  sendJson(response, 405, { message: 'method_not_allowed' }, getCorsHeaders(request))
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

  if (safeRelativePath.split('/').some((segment) => segment.startsWith('.'))) {
    sendJson(response, 404, { message: 'static_asset_not_found' })
    return
  }

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
    sendJson(response, 400, { message: 'bad_request' }, getCorsHeaders(request))
    return
  }

  let requestUrl

  try {
    requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`)
  } catch {
    sendJson(response, 400, { message: 'bad_request' }, getCorsHeaders(request))
    return
  }

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(request)) {
      sendJson(response, 403, { message: 'origin_not_allowed' }, getCorsHeaders(request))
      return
    }

    response.writeHead(204, {
      ...securityHeaders,
      ...getCorsHeaders(request),
    })
    response.end()
    return
  }

  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true }, getCorsHeaders(request))
    return
  }

  if (requestUrl.pathname === '/api/session') {
    await handleSessionRequest(request, response)
    return
  }

  if (requestUrl.pathname === '/api/state') {
    await handleStateRequest(request, response)
    return
  }

  await serveStaticFile(requestUrl.pathname, response)
})

server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.keepAliveTimeout = 5_000

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
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
