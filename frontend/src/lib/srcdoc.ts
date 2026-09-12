import type { GeneratedFile } from '@/types/generation'

function escapeClosingScript(value: string) {
  return value.replaceAll('</script>', '<\\/script>')
}

function buildHighLevelBridge(broadcastChannelName?: string) {
  const serializedChannelName = JSON.stringify(broadcastChannelName ?? '').replaceAll('<', '\\u003c')
  return `<script>
(() => {
  const channel = 'genesis.highlevel.v1';
  const broadcastChannelName = ${serializedChannelName};
  let sequence = 0;
  const pending = new Map();
  const bridgeHost = window.parent !== window ? window.parent : null;
  const broadcast = !bridgeHost && broadcastChannelName && 'BroadcastChannel' in window
    ? new BroadcastChannel(broadcastChannelName)
    : null;
  const invoke = (operation, parameters = {}) => new Promise((resolve, reject) => {
    if (!bridgeHost && !broadcast) {
      reject(new Error('HighLevel data is unavailable because the preview lost its connection to Genesis. Reopen the preview from the builder.'));
      return;
    }
    const requestId = String(++sequence) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    pending.set(requestId, { resolve, reject });
    const message = { channel, direction: 'request', requestId, operation, parameters };
    bridgeHost ? bridgeHost.postMessage(message, '*') : broadcast.postMessage(message);
  });
  const handleResponse = (data) => {
    if (data?.channel !== channel || data?.direction !== 'response') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    data.ok ? request.resolve(data.data) : request.reject(new Error(data.error || 'HighLevel request failed.'));
  };
  window.addEventListener('message', (event) => {
    if (event.source !== bridgeHost) return;
    handleResponse(event.data);
  });
  if (broadcast) {
    broadcast.addEventListener('message', (event) => handleResponse(event.data));
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
  }) });
})();
<\/script>`
}

const emptyPreviewMarkup = `<main class="genesis-empty-preview">
  <p>Describe an app in the chat to see it here.</p>
</main>`
const emptyPreviewStyles = `:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141411;font-family:ui-sans-serif,system-ui,sans-serif}.genesis-empty-preview{color:#777870;text-align:center;padding:24px}.genesis-empty-preview p{margin:0;font-size:13px}`

export function buildSrcdoc(
  files: Record<string, GeneratedFile>,
  options: { enableHighLevelBridge?: boolean; highLevelBridgeChannel?: string } = {},
) {
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
${options.enableHighLevelBridge ? buildHighLevelBridge(options.highLevelBridgeChannel) : ''}
<script>${escapeClosingScript(script)}<\/script>
</body>
</html>`
}
