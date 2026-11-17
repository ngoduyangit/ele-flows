/**
 * Canvas previews: a 2K image drawn at 50–300 px still costs a full decode on every pan/zoom, and every
 * <video> on the canvas downloads and decodes its clip. Node previews therefore ask the server for a cached
 * JPEG (/api/media/<file>?w=…): a thumbnail for images, a poster frame for videos. Videos only load when
 * the user presses play. Full-size views (lightbox, crop/split tools, downloads) keep the original URL.
 */
const IMAGE = /\.(png|jpe?g|webp|gif)$/i
const VIDEO = /\.(mp4|webm|mov)$/i

export function thumbUrl(url: string | undefined, width = 768): string | undefined {
  if (!url || !url.startsWith('/api/media/') || url.includes('?')) return url
  return IMAGE.test(url) ? `${url}?w=${width}` : url
}

/** Poster frame of a local video clip (undefined for remote/blob URLs – no server-side frame for those). */
export function posterUrl(url: string | undefined, width = 768): string | undefined {
  if (!url || !url.startsWith('/api/media/') || url.includes('?') || !VIDEO.test(url)) return undefined
  return `${url}?w=${width}`
}
