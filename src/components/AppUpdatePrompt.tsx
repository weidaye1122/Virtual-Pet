import { useEffect, useState } from 'react'

declare const __APP_BUILD_ID__: string
declare const __APP_VERSION__: string

type AppVersionManifest = {
  buildId?: string
  version?: string
}

type AvailableUpdate = {
  buildId: string
  version: string
}

const updateCheckIntervalMs = 5 * 60 * 1000

const createVersionUrl = () => {
  const url = new URL('/app-version.json', window.location.origin)
  url.searchParams.set('t', Date.now().toString())

  return url.toString()
}

const normalizeManifestValue = (value: unknown) => (typeof value === 'string' ? value : '')

const fetchAvailableUpdate = async (): Promise<AvailableUpdate | null> => {
  const response = await fetch(createVersionUrl(), {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store',
    },
  })

  if (!response.ok) {
    return null
  }

  const manifest = (await response.json()) as AppVersionManifest
  const buildId = normalizeManifestValue(manifest.buildId)
  const version = normalizeManifestValue(manifest.version)

  if (!buildId && !version) {
    return null
  }

  const hasNewBuild = Boolean(buildId && buildId !== __APP_BUILD_ID__)
  const hasNewVersion = Boolean(version && version !== __APP_VERSION__)

  return hasNewBuild || hasNewVersion
    ? {
        buildId,
        version: version || '新版',
      }
    : null
}

const clearOptionalBrowserCaches = async () => {
  if ('caches' in window) {
    const cacheNames = await window.caches.keys()
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)))
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }
}

export const AppUpdatePrompt = () => {
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    let isCancelled = false

    const checkForUpdate = async () => {
      try {
        const nextUpdate = await fetchAvailableUpdate()

        if (!isCancelled && nextUpdate) {
          setAvailableUpdate(nextUpdate)
        }
      } catch {
        // Update checks are best-effort. A failed check should not interrupt the app.
      }
    }

    const handleFocus = () => {
      void checkForUpdate()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate()
      }
    }

    void checkForUpdate()
    const intervalId = window.setInterval(checkForUpdate, updateCheckIntervalMs)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)

    try {
      await clearOptionalBrowserCaches()
    } finally {
      const url = new URL(window.location.href)
      url.searchParams.set('app-refresh', Date.now().toString())
      window.location.replace(url.toString())
    }
  }

  if (!availableUpdate) {
    return null
  }

  return (
    <div aria-live="polite" className="app-update-prompt" role="status">
      <span className="app-update-prompt__text">
        发现新版本 {availableUpdate.version}
      </span>
      <button
        className="app-update-prompt__button"
        disabled={isRefreshing}
        onClick={handleRefresh}
        type="button"
      >
        {isRefreshing ? '刷新中' : '强制刷新'}
      </button>
    </div>
  )
}
