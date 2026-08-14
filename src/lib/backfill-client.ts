import imageCompression from 'browser-image-compression'
import exifr from 'exifr'

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function prepare(file: File): Promise<{ dataUrl: string; cookedAt: string; fileName: string }> {
  const exif = await exifr.parse(file, { pick: ['DateTimeOriginal'] }).catch(() => null)
  const cookedAt = exif?.DateTimeOriginal instanceof Date
    ? exif.DateTimeOriginal.toISOString()
    : new Date().toISOString()
  const compressed = await imageCompression(file, {
    maxSizeMB: 1, maxWidthOrHeight: 1600, useWebWorker: false, fileType: 'image/jpeg',
  })
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(compressed)
  })
  return { dataUrl, cookedAt, fileName: file.name }
}

export async function runBackfill(files: File[], onProgress: (done: number, total: number) => void): Promise<number> {
  const chunks = chunk(files, 3)
  let imported = 0
  for (const batch of chunks) {
    const photos = await Promise.all(batch.map(prepare))
    const res = await fetch('/api/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos }),
    })
    if (!res.ok) throw new Error('backfill failed')
    const { imported: n } = await res.json()
    imported += n
    onProgress(imported, files.length)
  }
  return imported
}
