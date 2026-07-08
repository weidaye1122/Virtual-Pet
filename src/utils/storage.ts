import type { PersistedAppState } from '../types'

const cloneValue = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

export const storageKeys = {
  pet: 'pet-data',
  tasks: 'task-data',
  shop: 'shop-data',
  inventory: 'inventory-data',
  pointRecords: 'point-records',
  meta: 'pet-meta-data',
  sessionUnlock: 'pet-session-unlock',
} as const

const persistenceApiPath = import.meta.env.VITE_PERSISTENCE_API_PATH || '/api/state'
const sessionApiPath = import.meta.env.VITE_SESSION_API_PATH || '/api/session'
const requestedWithHeaderValue = 'fetch'
let csrfToken = ''

export type RemoteSessionStatus = {
  authenticated: boolean
  csrfToken?: string
  hasPassword: boolean
  setupRequired: boolean
}

export class RemoteAuthRequiredError extends Error {
  constructor() {
    super('remote_auth_required')
    this.name = 'RemoteAuthRequiredError'
  }
}

const updateCsrfToken = (value: unknown) => {
  if (typeof value === 'string') {
    csrfToken = value
  }
}

const loadSlice = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return cloneValue(fallback)
  }

  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : cloneValue(fallback)
  } catch {
    return cloneValue(fallback)
  }
}

const saveSlice = <T,>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, JSON.stringify(value))
}

export const loadLocalAppState = (fallback: PersistedAppState): PersistedAppState => ({
  pet: loadSlice(storageKeys.pet, fallback.pet),
  tasks: loadSlice(storageKeys.tasks, fallback.tasks),
  shopItems: loadSlice(storageKeys.shop, fallback.shopItems),
  inventory: loadSlice(storageKeys.inventory, fallback.inventory),
  pointRecords: loadSlice(storageKeys.pointRecords, fallback.pointRecords),
  meta: loadSlice(storageKeys.meta, fallback.meta),
})

export const saveLocalAppState = (state: PersistedAppState) => {
  saveSlice(storageKeys.pet, state.pet)
  saveSlice(storageKeys.tasks, state.tasks)
  saveSlice(storageKeys.shop, state.shopItems)
  saveSlice(storageKeys.inventory, state.inventory)
  saveSlice(storageKeys.pointRecords, state.pointRecords)
  saveSlice(storageKeys.meta, state.meta)
}

export const clearLocalAppState = () => {
  if (typeof window === 'undefined') {
    return
  }

  Object.values(storageKeys).forEach((key) => {
    window.localStorage.removeItem(key)
  })
  clearSessionUnlock()
}

export const loadSessionUnlock = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.sessionStorage.getItem(storageKeys.sessionUnlock) ?? ''
}

export const saveSessionUnlock = (passwordHash: string) => {
  if (typeof window === 'undefined' || !passwordHash) {
    return
  }

  window.sessionStorage.setItem(storageKeys.sessionUnlock, '1')
}

export const clearSessionUnlock = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(storageKeys.sessionUnlock)
}

export const loadRemoteAppState = async () => {
  const response = await fetch(persistenceApiPath, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 404) {
    return null
  }

  if (response.status === 401) {
    throw new RemoteAuthRequiredError()
  }

  if (!response.ok) {
    throw new Error(`加载后端存档失败: ${response.status}`)
  }

  return (await response.json()) as PersistedAppState
}

export const saveRemoteAppState = async (state: PersistedAppState) => {
  const response = await fetch(persistenceApiPath, {
    body: JSON.stringify(state),
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': requestedWithHeaderValue,
    },
    method: 'PUT',
  })

  if (response.status === 401) {
    throw new RemoteAuthRequiredError()
  }

  if (!response.ok) {
    throw new Error(`保存后端存档失败: ${response.status}`)
  }

  const payload = await response.json().catch(() => null)
  updateCsrfToken(payload?.csrfToken)
}

export const loadRemoteSessionStatus = async () => {
  const response = await fetch(sessionApiPath, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`读取登录状态失败: ${response.status}`)
  }

  const payload = (await response.json()) as RemoteSessionStatus
  updateCsrfToken(payload.csrfToken)

  return payload
}

export const unlockRemoteSession = async (password: string) => {
  const response = await fetch(sessionApiPath, {
    body: JSON.stringify({ password }),
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': requestedWithHeaderValue,
    },
    method: 'POST',
  })

  if (response.status === 401) {
    return false
  }

  if (!response.ok) {
    throw new Error(`登录后端存档失败: ${response.status}`)
  }

  const payload = await response.json()
  updateCsrfToken(payload?.csrfToken)

  return Boolean(payload?.authenticated)
}
