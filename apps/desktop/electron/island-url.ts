// The Dynamic Island's renderer URL. Electron-free so the query contract is
// unit-testable — same split, and the same trap, as `hud-url.ts`: `?win=island`
// and `notch=` MUST sit in the search string before the '#', or HashRouter
// swallows them as part of the route.
//
// `notch` rides the URL rather than an IPC call because it is a fact about the
// display that is known before the window loads, and the renderer's FIRST paint
// already has to be the right shape — a pill that paints as a floating bar and
// then jumps into the housing reads as a glitch.

import { pathToFileURL } from 'node:url'

export function buildIslandWindowUrl({
  devServer,
  notched,
  profile,
  rendererIndexPath
}: {
  devServer?: null | string
  notched: boolean
  profile?: null | string
  rendererIndexPath?: string
}): string {
  const profileKey = typeof profile === 'string' ? profile.trim() : ''
  const query = `?win=island${notched ? '&notch=1' : ''}${profileKey ? `&profile=${encodeURIComponent(profileKey)}` : ''}`

  if (devServer) {
    const base = devServer.endsWith('/') ? devServer.slice(0, -1) : devServer

    return `${base}/${query}#/`
  }

  return `${pathToFileURL(rendererIndexPath!).toString()}${query}#/`
}
