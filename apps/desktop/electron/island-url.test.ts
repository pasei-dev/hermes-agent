import { describe, expect, it } from 'vitest'

import { buildIslandWindowUrl } from './island-url'

describe('buildIslandWindowUrl', () => {
  it('carries the window flag before the hash, where HashRouter cannot swallow it', () => {
    const url = buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', profile: 'pasei' })

    expect(url).toBe('http://127.0.0.1:5174/?win=island&profile=pasei#/')
    expect(url.indexOf('?win=island')).toBeLessThan(url.indexOf('#'))
  })

  it('omits the profile when none is asked for, and trims a blank one', () => {
    expect(buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174' })).toBe('http://127.0.0.1:5174/?win=island#/')
    expect(buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', profile: '   ' })).toBe(
      'http://127.0.0.1:5174/?win=island#/'
    )
  })

  it('encodes a profile whose name needs it', () => {
    const url = buildIslandWindowUrl({ devServer: 'http://127.0.0.1:5174', profile: 'a/b c' })

    expect(url).toContain('&profile=a%2Fb%20c#')
  })

  it('builds a file URL against the packaged renderer index', () => {
    const url = buildIslandWindowUrl({ rendererIndexPath: '/tmp/app/dist/index.html' })

    expect(url.startsWith('file://')).toBe(true)
    expect(url).toContain('?win=island#/')
  })
})
