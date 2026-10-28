// The Dynamic Island's renderer URL. Electron-free so the query contract is
// unit-testable — same split, and the same trap, as `hud-url.ts`: `?win=island`
// and the optional `profile=` MUST sit in the search string before the '#', or
// HashRouter swallows them as part of the route and the window boots as an
// ordinary app window.

import { pathToFileURL } from 'node:url'

export function buildIslandWindowUrl({
  devServer,
  profile,
  rendererIndexPath
}: {
  devServer?: null | string
  profile?: null | string
  rendererIndexPath?: string
}): string {
  const profileKey = typeof profile === 'string' ? profile.trim() : ''
  const query = `?win=island${profileKey ? `&profile=${encodeURIComponent(profileKey)}` : ''}`

  if (devServer) {
    const base = devServer.endsWith('/') ? devServer.slice(0, -1) : devServer

    return `${base}/${query}#/`
  }

  return `${pathToFileURL(rendererIndexPath!).toString()}${query}#/`
}
