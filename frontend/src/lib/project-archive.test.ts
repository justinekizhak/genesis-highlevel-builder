import { describe, expect, it } from 'vitest'
import { buildProjectArchive, projectArchiveFilename } from './project-archive'

const decoder = new TextDecoder()

function readStoredEntries(archive: Uint8Array) {
  const entries: Record<string, string> = {}
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(archive.slice(nameStart, nameStart + nameLength))
    entries[name] = decoder.decode(archive.slice(dataStart, dataStart + size))
    offset = dataStart + size
  }
  return entries
}

describe('project archive', () => {
  it('packages generated files into a ZIP archive', () => {
    const files = {
      'index.html': '<main>Hello</main>',
      'styles.css': 'main { color: red; }',
      'src/app.js': 'console.log("hello")',
    }
    const archive = buildProjectArchive(files)

    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(readStoredEntries(archive)).toEqual(files)
    expect(new DataView(archive.buffer).getUint32(archive.length - 22, true)).toBe(0x06054b50)
  })

  it('rejects paths that could escape the archive', () => {
    expect(() => buildProjectArchive({ '../secret.txt': 'nope' })).toThrow('unsafe file path')
  })

  it('creates a filesystem-friendly project filename', () => {
    expect(projectArchiveFilename(' Café CRM / Follow-ups ')).toBe('cafe-crm-follow-ups.zip')
    expect(projectArchiveFilename('!!!')).toBe('genesis-project.zip')
  })
})
