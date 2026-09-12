const encoder = new TextEncoder()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

function joinBytes(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function safeArchivePath(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Cannot export unsafe file path: ${path}`)
  }
  return normalized
}

/** Builds a standards-compliant, store-only ZIP archive without a runtime dependency. */
export function buildProjectArchive(files: Record<string, string>) {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let localOffset = 0

  for (const [rawPath, content] of Object.entries(files)) {
    const name = encoder.encode(safeArchivePath(rawPath))
    const data = encoder.encode(content)
    const checksum = crc32(data)

    const localHeader = new Uint8Array(30 + name.length)
    const localView = new DataView(localHeader.buffer)
    writeUint32(localView, 0, 0x04034b50)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0x0800)
    writeUint32(localView, 14, checksum)
    writeUint32(localView, 18, data.length)
    writeUint32(localView, 22, data.length)
    writeUint16(localView, 26, name.length)
    localHeader.set(name, 30)
    localChunks.push(localHeader, data)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, 0x02014b50)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0x0800)
    writeUint32(centralView, 16, checksum)
    writeUint32(centralView, 20, data.length)
    writeUint32(centralView, 24, data.length)
    writeUint16(centralView, 28, name.length)
    writeUint32(centralView, 42, localOffset)
    centralHeader.set(name, 46)
    centralChunks.push(centralHeader)

    localOffset += localHeader.length + data.length
  }

  const centralDirectory = joinBytes(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 8, centralChunks.length)
  writeUint16(endView, 10, centralChunks.length)
  writeUint32(endView, 12, centralDirectory.length)
  writeUint32(endView, 16, localOffset)

  return joinBytes([...localChunks, centralDirectory, end])
}

export function projectArchiveFilename(projectName: string) {
  const slug = projectName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${slug || 'genesis-project'}.zip`
}
