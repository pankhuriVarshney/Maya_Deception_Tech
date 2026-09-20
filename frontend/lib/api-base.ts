/**
 * Resolves the backend's base URL.
 *
 * Docker Compose puts the backend on its own internal hostname
 * ("backend"), which only resolves inside the compose network -- a
 * browser on the host (or any other device) can never reach it, no
 * matter what NEXT_PUBLIC_API_URL is set to (that's a Next.js
 * build-time value anyway, and the frontend Dockerfile never receives
 * it as a build arg, so the browser bundle always falls back to
 * whatever default is hardcoded here).
 *
 * Since docker-compose publishes the backend on the same well-known
 * port (3001) on the host as the frontend is reached on, we instead
 * derive the address from the page's own hostname at runtime: whatever
 * host/IP the browser used to load the app, the backend is reachable
 * at that same host on port 3001. This makes the app work unmodified
 * from localhost, a LAN IP, or any other device -- no per-machine
 * config needed.
 */

const BACKEND_PORT = 3001

export function getApiHttpBase(): string {
  if (typeof window === "undefined") {
    // Server-side (Route Handlers, Server Components) runs inside the
    // container, where the Docker Compose service name resolves fine.
    return process.env.NEXT_PUBLIC_API_URL ?? "http://backend:3001"
  }
  return `${window.location.protocol}//${window.location.hostname}:${BACKEND_PORT}`
}

export function getApiWsBase(): string {
  if (typeof window === "undefined") {
    return (process.env.NEXT_PUBLIC_API_URL ?? "http://backend:3001").replace(/^http/, "ws")
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${wsProtocol}//${window.location.hostname}:${BACKEND_PORT}`
}
