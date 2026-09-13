import type { GeneratedFile } from '@/types/generation'

function escapeClosingScript(value: string) {
  return value.replaceAll('</script>', '<\\/script>')
}

function buildHighLevelBridge(broadcastChannelName?: string, directProxy?: { functionsBase: string; idToken: string }) {
  const serializedChannelName = JSON.stringify(broadcastChannelName ?? '').replaceAll('<', '\\u003c')
  const serializedDirectProxy = JSON.stringify(directProxy ?? null).replaceAll('<', '\\u003c')
  return `<script>
(() => {
  const channel = 'genesis.highlevel.v1';
  const broadcastChannelName = ${serializedChannelName};
  const directProxy = ${serializedDirectProxy};
  let sequence = 0;
  const pending = new Map();
  const bridgeHost = !directProxy && window.parent !== window ? window.parent : null;
  const broadcast = !directProxy && !bridgeHost && broadcastChannelName && 'BroadcastChannel' in window
    ? new BroadcastChannel(broadcastChannelName)
    : null;
  const invokeDirect = (operation, parameters) => fetch(directProxy.functionsBase + '/hlProxy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + directProxy.idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, parameters }),
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'HighLevel request failed.');
    return body.data;
  });
  const invoke = (operation, parameters = {}) => {
    if (directProxy) return invokeDirect(operation, parameters);
    return new Promise((resolve, reject) => {
      if (!bridgeHost && !broadcast) {
        reject(new Error('HighLevel data is unavailable because the preview lost its connection to Genesis. Reopen the preview from the builder.'));
        return;
      }
      const requestId = String(++sequence) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      pending.set(requestId, { resolve, reject });
      const message = { channel, direction: 'request', requestId, operation, parameters };
      bridgeHost ? bridgeHost.postMessage(message, '*') : broadcast.postMessage(message);
    });
  };
  const eventListeners = new Set();
  const emitEvent = (hlEvent) => {
    eventListeners.forEach((listener) => {
      try { listener(hlEvent); } catch (error) { console.error('HighLevel event listener failed', error); }
    });
  };
  const handleMessage = (data) => {
    if (data?.channel !== channel) return;
    if (data.direction === 'event') { emitEvent(data.event); return; }
    if (data.direction !== 'response') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    data.ok ? request.resolve(data.data) : request.reject(new Error(data.error || 'HighLevel request failed.'));
  };
  if (!directProxy) {
    window.addEventListener('message', (event) => {
      if (event.source !== bridgeHost) return;
      handleMessage(event.data);
    });
  }
  if (broadcast) {
    broadcast.addEventListener('message', (event) => handleMessage(event.data));
    window.addEventListener('pagehide', () => {
      broadcast.postMessage({ channel, direction: 'disconnect' });
      broadcast.close();
    }, { once: true });
  }
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
    events: Object.freeze({
      subscribe: (listener) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
    }),
  }) });
})();
<\/script>`
}

const emptyPreviewMarkup = `<main class="genesis-empty-preview">
  <p>Describe an app in the chat to see it here.</p>
</main>`
const emptyPreviewStyles = `:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141411;font-family:ui-sans-serif,system-ui,sans-serif}.genesis-empty-preview{color:#777870;text-align:center;padding:24px}.genesis-empty-preview p{margin:0;font-size:13px}`
const generatedAppThemeGuard = `:root{color-scheme:dark;--background:#0d0e0d;--canvas:#11110f;--surface:#131412;--surface-raised:#1b1c19;--surface-hover:#22231f;--surface-sunken:#0a0b0a;--text:#f2f1ed;--text-soft:#c5c4bd;--text-muted:#9b9b93;--border:#30312c;--input:#3a3b35;--accent:#dfb85f;--accent-hover:#e7c36f;--accent-ink:#17150f;--ring:#e4bd65;--success:#85c98f;--warning:#efc973;--danger:#c85b54}html{background:var(--background);color-scheme:dark}body{background:var(--background);color:var(--text);font-family:Geist,"Avenir Next","SF Pro Text",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}button,input,select,textarea{color:inherit;font:inherit}select{color-scheme:dark;background-color:var(--surface-sunken)}::selection{background:rgb(223 184 95/.28);color:var(--text)}`

export function buildSrcdoc(
  files: Record<string, GeneratedFile>,
  options: {
    enableHighLevelBridge?: boolean
    highLevelBridgeChannel?: string
    highLevelDirectProxy?: { functionsBase: string; idToken: string }
  } = {},
) {
  const hasApp = Boolean(files['index.html'])
  const markup = files['index.html']?.content ?? emptyPreviewMarkup
  const styles = files['styles.css']?.content ?? (hasApp ? '' : emptyPreviewStyles)
  const script = files['app.js']?.content ?? ''
  const functionsOrigin = options.highLevelDirectProxy?.functionsBase
    ? new URL(options.highLevelDirectProxy.functionsBase).origin
    : undefined
  const connectSrc = ['https://cdn.jsdelivr.net', functionsOrigin]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replaceAll('"', ''))
    .join(' ')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; img-src data:; connect-src ${connectSrc}; form-action 'none'; base-uri 'none'" />
  <style>${styles}</style>
  ${hasApp ? `<style data-genesis-theme-guard>${generatedAppThemeGuard}</style>` : ''}
</head>
<body>
${markup}
${options.enableHighLevelBridge ? buildHighLevelBridge(options.highLevelBridgeChannel, options.highLevelDirectProxy) : ''}
<script>${escapeClosingScript(script)}<\/script>
</body>
</html>`
}
