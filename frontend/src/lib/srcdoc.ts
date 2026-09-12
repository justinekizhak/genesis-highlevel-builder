import type { GeneratedFile } from '@/types/generation'

function escapeClosingScript(value: string) {
  return value.replaceAll('</script>', '<\\/script>')
}

const highLevelBridge = `<script>
(() => {
  const channel = 'genesis.highlevel.v1';
  let sequence = 0;
  const pending = new Map();
  const hasBridgeHost = window.parent !== window;
  const invoke = (operation, parameters = {}) => new Promise((resolve, reject) => {
    if (!hasBridgeHost) {
      reject(new Error('HighLevel data is not available when the preview is opened in its own tab. Use the in-app preview panel for live HighLevel data.'));
      return;
    }
    const requestId = String(++sequence) + '-' + Date.now();
    pending.set(requestId, { resolve, reject });
    window.parent.postMessage({ channel, direction: 'request', requestId, operation, parameters }, '*');
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.channel !== channel || event.data?.direction !== 'response') return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    event.data.ok ? request.resolve(event.data.data) : request.reject(new Error(event.data.error || 'HighLevel request failed.'));
  });
  window.genesis = Object.freeze({ highlevel: Object.freeze({
    contacts: Object.freeze({
      list: (parameters) => invoke('contacts.list', parameters),
      create: (parameters) => invoke('contacts.create', parameters),
      update: (parameters) => invoke('contacts.update', parameters),
    }),
    conversations: Object.freeze({
      list: (parameters) => invoke('conversations.list', parameters),
      messages: (parameters) => invoke('conversations.messages', parameters),
      send: (parameters) => invoke('conversations.send', parameters),
    }),
    calendars: Object.freeze({
      list: (parameters) => invoke('calendars.list', parameters),
      availability: (parameters) => invoke('calendars.availability', parameters),
    }),
    appointments: Object.freeze({ list: (parameters) => invoke('appointments.list', parameters) }),
  }) });
})();
<\/script>`

const emptyPreviewMarkup = `<main class="genesis-empty-preview">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18" stroke-linecap="round"/></svg>
  <p>Describe an app in the chat to see it here.</p>
</main>`
const emptyPreviewStyles = `:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141411;font-family:ui-sans-serif,system-ui,sans-serif}.genesis-empty-preview{display:grid;justify-items:center;gap:10px;color:#6f6c62;text-align:center;padding:24px}.genesis-empty-preview svg{color:#4a4740}.genesis-empty-preview p{margin:0;font-size:13px}`

export function buildSrcdoc(files: Record<string, GeneratedFile>, options: { enableHighLevelBridge?: boolean } = {}) {
  const hasApp = Boolean(files['index.html'])
  const markup = files['index.html']?.content ?? emptyPreviewMarkup
  const styles = files['styles.css']?.content ?? (hasApp ? '' : emptyPreviewStyles)
  const script = files['app.js']?.content ?? ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; img-src data:; connect-src https://cdn.jsdelivr.net; form-action 'none'; base-uri 'none'" />
  <style>${styles}</style>
</head>
<body>
${markup}
${options.enableHighLevelBridge ? highLevelBridge : ''}
<script>${escapeClosingScript(script)}<\/script>
</body>
</html>`
}
