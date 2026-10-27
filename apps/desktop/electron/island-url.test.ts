import { describe, expect, it } from 'vitest'

import { buildIslandWindowUrl } from './island-url'

describe('buildIslandWindowUrl', () => {
  it('carries the window flag and the notch fact before the hash', () => {
    const url = buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', notched: true, profile: 'pasei' })

    expect(url).toBe('http://127.0.0.1:5174/?win=island&notch=1&profile=pasei#/')
    expect(url.indexOf('?win=island')).toBeLessThan(url.indexOf('#'))
  })

  it('leaves the notch fact out on a display that has none', () => {
    expect(buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', notched: false })).toBe(
      'http://127.0.0.1:5174/?win=island#/'
    )
  })

  it('omits a blank profile and encodes one that needs it', () => {
    expect(buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', notched: false, profile: '  ' })).not.toContain(
      'profile='
    )
    expect(buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', notched: true, profile: 'a/b c' })).toContain(
      '&profile=a%2Fb%20c#'
    )
  })

  it('builds a file URL against the packaged renderer index', () => {
    const url = buildIslandWindowUrl({ notched: true, rendererIndexPath: '/tmp/app/dist/index.html' })

    expect(url.startsWith('file://')).toBe(true)
    expect(url).toContain('?win=island&notch=1#/')
  })
})
