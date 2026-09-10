import type { GeneratedFile } from '@/types/generation'

function escapeClosingScript(value: string) {
  return value.replaceAll('</script>', '<\\/script>')
}

export function buildSrcdoc(files: Record<string, GeneratedFile>) {
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
<script>${escapeClosingScript(script)}<\/script>
</body>
</html>`
}
