// A minimal ZIP writer, so the whole knowledge base can be exported as one
// archive without pulling in a dependency.
//
// Deflate comes from the platform: `CompressionStream('deflate-raw')` is in
// every browser Deckle supports (Chrome 103+, Safari 16.4+, Firefox 113+). Where
// it isn't, or where compressing a file makes it bigger, the entry is stored
// uncompressed instead — a perfectly valid ZIP either way.
//
// Deliberately not implemented: Zip64. A Markdown library will not approach the
// 4 GiB / 65535-entry limits, and pretending otherwise would mean a much larger
// writer; `createZip` throws a clear error rather than emit a corrupt archive.

const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffffffff

export interface ZipEntry {
  /** Path inside the archive, POSIX separators, e.g. "Projects/idea.md". */
  path: string
  content: string | Uint8Array
  /** Modification time recorded in the archive (defaults to now). */
  modified?: Date
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time, the only timestamp format a base ZIP header carries. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    // Unsupported format on this engine — fall back to storing.
    return null
  }
}

/** A small growable byte buffer; ZIP headers are written field by field. */
class ByteWriter {
  private parts: Uint8Array[] = []
  length = 0

  push(bytes: Uint8Array): void {
    this.parts.push(bytes)
    this.length += bytes.length
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]))
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    )
  }

  parts_(): Uint8Array[] {
    return this.parts
  }
}

interface CentralRecord {
  nameBytes: Uint8Array
  crc: number
  compressedSize: number
  uncompressedSize: number
  method: number
  time: number
  date: number
  offset: number
}

/**
 * Build a ZIP archive. `onProgress` is called after each entry so a large
 * library can show progress rather than appearing to hang.
 */
export async function createZip(
  entries: ZipEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(
      `Too many files for a single archive (${entries.length}; the limit is ${MAX_ENTRIES}).`,
    )
  }

  const encoder = new TextEncoder()
  const out = new ByteWriter()
  const central: CentralRecord[] = []

  for (const [index, entry] of entries.entries()) {
    const nameBytes = encoder.encode(entry.path)
    const raw =
      typeof entry.content === 'string'
        ? encoder.encode(entry.content)
        : entry.content

    const compressed = await deflateRaw(raw)
    // Storing beats deflating for tiny or already-dense files.
    const useDeflate = compressed !== null && compressed.length < raw.length
    const body = useDeflate ? (compressed as Uint8Array) : raw
    const method = useDeflate ? 8 : 0

    const { time, date } = dosDateTime(entry.modified ?? new Date())
    const record: CentralRecord = {
      nameBytes,
      crc: crc32(raw),
      compressedSize: body.length,
      uncompressedSize: raw.length,
      method,
      time,
      date,
      offset: out.length,
    }

    // Local file header.
    out.u32(0x04034b50)
    out.u16(20) // version needed to extract (2.0 — deflate)
    out.u16(0x0800) // flags: bit 11 = file name is UTF-8
    out.u16(method)
    out.u16(time)
    out.u16(date)
    out.u32(record.crc)
    out.u32(record.compressedSize)
    out.u32(record.uncompressedSize)
    out.u16(nameBytes.length)
    out.u16(0) // extra field length
    out.push(nameBytes)
    out.push(body)

    central.push(record)
    onProgress?.(index + 1, entries.length)
  }

  const centralOffset = out.length
  for (const record of central) {
    out.u32(0x02014b50)
    out.u16(20) // version made by
    out.u16(20) // version needed to extract
    out.u16(0x0800)
    out.u16(record.method)
    out.u16(record.time)
    out.u16(record.date)
    out.u32(record.crc)
    out.u32(record.compressedSize)
    out.u32(record.uncompressedSize)
    out.u16(record.nameBytes.length)
    out.u16(0) // extra field length
    out.u16(0) // file comment length
    out.u16(0) // disk number start
    out.u16(0) // internal attributes
    out.u32(0) // external attributes
    out.u32(record.offset)
    out.push(record.nameBytes)
  }
  const centralSize = out.length - centralOffset

  if (out.length > MAX_BYTES) {
    throw new Error('The library is too large for a single ZIP archive (over 4 GB).')
  }

  // End of central directory.
  out.u32(0x06054b50)
  out.u16(0) // this disk
  out.u16(0) // disk with central directory
  out.u16(central.length)
  out.u16(central.length)
  out.u32(centralSize)
  out.u32(centralOffset)
  out.u16(0) // comment length

  return new Blob(out.parts_() as BlobPart[], { type: 'application/zip' })
}

/** Trigger a browser download for a built archive. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
