import { describe, expect, it } from 'vitest'
import { renderChatMarkdown } from './markdown'

describe('renderChatMarkdown', () => {
  it('renders bold, italic, inline code, and links', () => {
    const html = renderChatMarkdown('**bold** _italic_ `code` [link](https://example.com)')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('renders a bullet list', () => {
    const html = renderChatMarkdown('- one\n- two')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
  })

  it('strips script tags entirely', () => {
    const html = renderChatMarkdown('hello<script>alert(1)</script>world')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('strips event-handler attributes and javascript: links', () => {
    const html = renderChatMarkdown('[click me](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    const withImg = renderChatMarkdown('<img src=x onerror="alert(1)">')
    expect(withImg).not.toContain('onerror')
    expect(withImg).not.toContain('<img')
  })

  it('drops disallowed tags like iframe', () => {
    const html = renderChatMarkdown('<iframe src="https://evil.example.com"></iframe>text')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('text')
  })
})
