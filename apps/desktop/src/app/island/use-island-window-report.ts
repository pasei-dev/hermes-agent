// Tells MAIN how big the island is and whether it should be on screen at all.
//
// The window is a transparent rectangle anchored top-centre; the painted pill is
// much smaller and changes height as it expands. Two things follow, and both are
// window-level facts the page cannot express:
//   - the WINDOW must be exactly as tall as the painted surface, or the extra
//     transparent height is an invisible click-shield over the app behind it;
//   - a stage of `hidden` must actually HIDE it, which is the "no footprint when
//     nothing is running" half of the contract.
// Measured on the surface element rather than computed from a layout constant, so
// a wrapped command or a longer title grows the window instead of being clipped.
import { type RefObject, useEffect } from 'react'

import type { IslandStage } from './island-model'

export function useIslandWindowReport(stage: IslandStage, surfaceRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bridge = window.hermesDesktop?.island

    if (!bridge?.report) {
      return
    }

    if (stage === 'hidden') {
      bridge.report({ visible: false })

      return
    }

    const surface = surfaceRef.current

    if (!surface) {
      return
    }

    let lastHeight = 0

    const send = () => {
      const height = Math.ceil(surface.getBoundingClientRect().height)

      if (height <= 0 || height === lastHeight) {
        return
      }

      lastHeight = height
      bridge.report?.({ height, visible: true })
    }

    // Content changes without a stage change (a command wrapping to two lines,
    // a third running session): the observer is what keeps the window matching.
    const observer = new ResizeObserver(send)

    observer.observe(surface)
    send()

    return () => observer.disconnect()
  }, [stage, surfaceRef])
}
