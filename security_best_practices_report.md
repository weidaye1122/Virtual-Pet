# Security Best Practices Report

Date: 2026-07-08
Scope: `/Users/weidaye/Documents/Electronic Pet Cat`
Stack reviewed: React/Vite frontend, native Node HTTP persistence server, Docker image and Compose configs.
Status: Updated after remediation work in this workspace.

## Executive Summary

The app is relatively clean on common frontend injection risks: no `dangerouslySetInnerHTML`, `eval`, dynamic script loading, `postMessage` handlers, third-party script tags, committed `.env` files, or known dependency vulnerabilities were found. The static file server also has a path traversal guard and a request body size cap.

The original main security problem was the persistence API. It allowed unauthenticated read/write/delete access to the whole pet save file. This has now been addressed by adding server-side PIN verification, HttpOnly session cookies, CSRF checks for state-changing requests, stricter origin handling, and server-side persisted-state validation.

## Remediation Summary

- Fixed SEC-001 by requiring a valid server session for `/api/state` once a password-backed save exists.
- Fixed SEC-002's most important impact by moving the remote authorization boundary to the server and no longer storing the password hash as the session unlock marker.
- Fixed SEC-003 by removing wildcard CORS behavior and only reflecting explicitly allowed/same-host origins.
- Fixed SEC-004 by adding centralized security response headers in `server/index.mjs`.
- Fixed SEC-005 by validating the persisted state shape before writing it.
- Fixed SEC-006 by running the final Docker image as the non-root `node` user.
- Improved SEC-007 by adding login throttling and Node HTTP timeout settings.

## Critical / High Findings

### SEC-001: Unauthenticated state API can read, overwrite, and delete all app data

- Rule ID: NODE-AUTHZ-001 / REACT-AUTHZ-001
- Severity: High; Critical if the container port is reachable from the public internet.
- Status: Fixed.
- Location:
  - `server/index.mjs:96-150`
  - `server/index.mjs:238-240`
  - `compose.yaml:5-6`
  - `compose.synology.yaml:12-15`
- Original evidence:
  - `GET /api/state` reads and returns `dataFile` with no authentication or authorization check.
  - `PUT /api/state` parses any JSON and writes it directly to `dataFile`.
  - `DELETE /api/state` removes `dataFile`.
  - Compose publishes container port `4173` to the host.
- Pre-fix verification:
  - With a temporary local data file, unauthenticated `PUT /api/state` returned `200`, unauthenticated `GET /api/state` returned `200`, unauthenticated `DELETE /api/state` returned `200`, and `GET` after deletion returned `404`.
- Impact:
  - A reachable attacker can wipe the save, rewrite pet/task/inventory data, replace `meta.passwordHash`, or harvest the stored hash/salt for offline guessing.
- Fix:
  - Implemented `/api/session` login with server-side password verification.
  - Implemented HttpOnly `pet_session` cookies for authenticated state access.
  - `/api/state` now returns `401` for unauthenticated reads/writes/deletes after setup.
- Mitigation:
  - Server auth now exists, but avoid exposing `4173:4173` directly on an internet-facing host when a reverse proxy can front it.
  - If deployed behind HTTPS, set `SESSION_COOKIE_SECURE=true`.
- False positive notes:
  - If another production gateway already enforces authentication before traffic reaches this server, document and verify that gateway. It is not visible in this repository.

### SEC-002: Browser PIN is stored and checked client-side, so it is not a durable security control

- Rule ID: REACT-AUTH-001 / REACT-AUTHZ-001
- Severity: High when combined with SEC-001; Medium for local-only deployments.
- Status: Fixed for remote access; local browser cache remains a convenience fallback.
- Location:
  - `src/utils/auth.ts:19-47`
  - `src/utils/storage.ts:73-87`
  - `src/hooks/PetProvider.tsx:142-143`
  - `src/components/AuthGate.tsx:95-111`
  - `src/hooks/PetProvider.tsx:2169-2196`
- Original evidence:
  - PINs are normalized to numeric input and capped at 12 digits.
  - The password hash is a single SHA-256 digest of `salt:pin`.
  - The successful unlock marker stores the same password hash in `sessionStorage`.
  - The login check compares a client-computed hash to `meta.passwordHash`.
- Impact:
  - Anyone who can read local browser storage or the remote state file can bypass or brute-force the PIN offline. A 4-digit minimum PIN is especially guessable.
- Fix:
  - Remote login now validates the PIN server-side.
  - The browser no longer stores the password hash as the session unlock marker.
  - Failed server logins are throttled.
- Mitigation:
  - Keep the app behind network-level access control until real server auth is in place.

## Medium Findings

### SEC-003: Broad CORS preflight allows cross-origin state-changing requests

- Rule ID: REACT-CSRF-001 / EXPRESS-CORS-001 equivalent
- Severity: Medium; High if auth cookies or credentialed sessions are added later without changing CORS.
- Status: Fixed.
- Location:
  - `server/index.mjs:223-228`
  - `src/utils/storage.ts:115-122`
- Original evidence:
  - The server responds to all `OPTIONS` requests with `Access-Control-Allow-Origin: *`.
  - It advertises `GET,PUT,DELETE,OPTIONS`.
  - The client uses JSON `PUT` to persist state.
- Impact:
  - A malicious website can trigger the browser to send state-changing requests to a reachable app instance. Even if the response is unreadable, the write/delete side effect can still occur after a successful preflight.
- Fix:
  - Wildcard CORS was removed.
  - Cross-origin preflight from an untrusted origin now receives `403`.
  - State-changing requests require a custom request marker and CSRF token when authenticated.
- Mitigation:
  - Put the service behind a same-origin reverse proxy and keep `/api/state` private to that origin.

### SEC-004: Security headers are missing in the app server and not present on the checked live homepage

- Rule ID: REACT-HEADERS-001 / JS-CSP-001
- Severity: Medium.
- Status: Fixed in repository server code; still verify any external proxy/CDN.
- Location:
  - `server/index.mjs:26-30`
  - `index.html:4-15`
- Original evidence:
  - The local server sets `Cache-Control` and `Content-Type`, but not `Content-Security-Policy`, `X-Frame-Options` or CSP `frame-ancestors`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, or `Permissions-Policy`.
  - `index.html` has no CSP meta fallback.
  - A non-destructive header check of `https://ep.543221.xyz:6/` also did not show these security headers.
- Impact:
  - Missing headers reduce browser defense-in-depth against XSS impact, clickjacking, MIME sniffing, and referrer leakage.
- Fix:
  - Added centralized CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` headers.
- Mitigation:
  - Verify production headers after deployment, since edge infrastructure may differ from repository code.

### SEC-005: Persisted state is not schema-validated on the server

- Rule ID: NODE-INPUT-001
- Severity: Medium.
- Status: Fixed.
- Location:
  - `server/index.mjs:115-121`
  - `src/hooks/PetProvider.tsx:454-465`
- Original evidence:
  - The server accepts any valid JSON and writes it as the canonical save file.
  - Shape normalization happens only later in the client.
- Impact:
  - Invalid or maliciously shaped JSON can corrupt the save file, cause app breakage, or enlarge the blast radius of SEC-001.
- Fix:
  - Added top-level state, task, shop item, inventory, meta, password hash/salt, and avatar-size validation before writing.
- Mitigation:
  - Keep `maxBodyBytes` conservative and add backups/versioned writes so a bad save can be rolled back.

## Low Findings

### SEC-006: Container runtime does not drop root privileges

- Rule ID: CONTAINER-HARDENING-001
- Severity: Low to Medium, depending on host exposure.
- Status: Fixed.
- Location:
  - `Dockerfile:11-26`
- Original evidence:
  - The final image uses `node:22-alpine` but does not define a non-root `USER`.
- Impact:
  - If the Node process or a dependency is compromised, the attacker gets root inside the container, which increases the impact of container escape or mounted-volume abuse.
- Fix:
  - The final image copies app files as `node:node`, prepares `/data`, and runs with `USER node`.
- Mitigation:
  - Use runtime flags such as read-only root filesystem where practical, least-privilege volume mounts, and no extra Linux capabilities.

### SEC-007: No explicit app-level rate limiting or request timeout hardening

- Rule ID: NODE-DOS-001
- Severity: Low.
- Status: Improved.
- Location:
  - `server/index.mjs:12`
  - `server/index.mjs:72-94`
  - `server/index.mjs:215-244`
- Original evidence:
  - There is a 10 MB body cap, which is good.
  - There is no route-level throttling, failed-login throttling, or explicit server timeout configuration in repository code.
- Impact:
  - A reachable deployment is more exposed to brute-force PIN attempts and simple resource exhaustion.
- Fix:
  - Added server-side failed-login throttling.
  - Added explicit Node request, header, and keep-alive timeouts.
  - Kept the 10 MB default body cap for avatar compatibility, with `MAX_BODY_BYTES` available for deployment tuning.

## Positive Findings

- No dangerous React HTML escape hatches were found: no `dangerouslySetInnerHTML` or `__html`.
- No direct DOM HTML injection sinks were found: no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`.
- No dynamic code execution patterns were found: no `eval`, `new Function`, string-based timers, or dynamic script injection.
- No `postMessage` handlers were found.
- No third-party script tags were found in `index.html`.
- No committed `.env`, private key, token, or credential files were found in the repository scan.
- Static file serving uses `resolve` plus an inside-directory check before reading files.
- Dependency scan using the current lockfile returned: `No known vulnerabilities found`.
- A lockfile exists: `pnpm-lock.yaml`.
- Production startup does not expose `--inspect`, and `insecureHTTPParser` was not found.

## Live Deployment Notes

A quick non-destructive check of `https://ep.543221.xyz:6/` showed an nginx-served homepage without the security headers listed in SEC-004. The checked live `/api/state` behavior did not exactly match this repository's native Node server: `GET /api/state` returned `404` with HTML, while an `OPTIONS /api/state` preflight reflected the supplied origin, included `Access-Control-Allow-Credentials: true`, and exposed `X-Powered-By: Express`. That suggests the public endpoint may be fronted by different or older infrastructure. Treat the repository findings above as the risk of the code as shipped by this repo, and separately verify the live proxy/app routing before relying on the public deployment's current behavior.

## Post-Fix Verification

1. `pnpm build` passed with the bundled Node runtime.
2. `pnpm lint` passed with the bundled Node runtime.
3. Temporary local API verification passed:
   - before setup, `GET /api/session` returned setup required
   - empty unauthenticated setup save without a password returned `400`
   - untrusted cross-origin preflight returned `403`
   - after setup, unauthenticated `GET /api/state` returned `401`
   - authenticated `GET /api/state` returned `200`
   - wrong login returned `401`
   - correct login returned `200`
   - authenticated write without CSRF returned `403`
   - authenticated write with CSRF returned `200`
   - unauthenticated delete returned `401`
   - authenticated delete with CSRF returned `200`
