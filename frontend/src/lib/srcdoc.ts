import type { GeneratedFile } from '@/types/generation'

function escapeClosingScript(value: string) {
  return value.replaceAll('</script>', '<\\/script>')
}

const highLevelBridge = `<script>
(() => {
  const channel = 'genesis.highlevel.v1';
  let sequence = 0;
  const pending = new Map();
  const invoke = (operation, parameters = {}) => new Promise((resolve, reject) => {
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

export function buildSrcdoc(files: Record<string, GeneratedFile>, options: { enableHighLevelBridge?: boolean } = {}) {
  const markup = files['index.html']?.content ?? '<main><p>No index.html generated yet.</p></main>'
  const styles = files['styles.css']?.content ?? ''
  const script = files['app.js']?.content ?? ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'" />
  <style>${styles}</style>
</head>
<body>
${markup}
${options.enableHighLevelBridge ? highLevelBridge : ''}
<script>${escapeClosingScript(script)}<\/script>
</body>
</html>`
}
