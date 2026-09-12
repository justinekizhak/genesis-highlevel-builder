import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

/** Renders a chat message as sanitized HTML. Assistant summaries are model output, not trusted markup. */
export function renderChatMarkdown(source: string): string {
  const html = marked.parse(source, { async: false })
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'br', 'blockquote', 'h1', 'h2', 'h3'],
    ALLOWED_ATTR: ['href'],
  })
}
