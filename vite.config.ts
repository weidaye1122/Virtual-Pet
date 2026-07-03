import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }
const appVersion = packageJson.version
const appBuildId = `${appVersion}-${process.env.GITHUB_SHA?.slice(0, 12) ?? Date.now().toString(36)}`
const appVersionManifest = `${JSON.stringify(
  {
    buildId: appBuildId,
    version: appVersion,
  },
  null,
  2,
)}\n`

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    {
      generateBundle() {
        this.emitFile({
          fileName: 'app-version.json',
          source: appVersionManifest,
          type: 'asset',
        })
      },
      name: 'emit-app-version',
    },
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4300',
      },
    },
  },
})
