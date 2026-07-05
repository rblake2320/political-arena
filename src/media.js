const MB = 1024 * 1024;

export const ALLOWED_MEDIA_TYPES = {
  // Common browser/phone video containers. Browser playback still depends on
  // the user's device codecs; unsupported codecs fall back to an external link.
  'video/mp4': { ext: 'mp4', maxSize: 100 * MB, kind: 'video' },
  'video/x-m4v': { ext: 'm4v', maxSize: 100 * MB, kind: 'video' },
  'video/quicktime': { ext: 'mov', maxSize: 100 * MB, kind: 'video' },
  'video/webm': { ext: 'webm', maxSize: 100 * MB, kind: 'video' },
  'video/ogg': { ext: 'ogv', maxSize: 100 * MB, kind: 'video' },
  'video/3gpp': { ext: '3gp', maxSize: 100 * MB, kind: 'video' },
  'video/3gpp2': { ext: '3g2', maxSize: 100 * MB, kind: 'video' },
  'video/mpeg': { ext: 'mpg', maxSize: 100 * MB, kind: 'video' },
  'video/x-msvideo': { ext: 'avi', maxSize: 100 * MB, kind: 'video' },

  // Images, including formats commonly produced by modern phones.
  'image/jpeg': { ext: 'jpg', maxSize: 15 * MB, kind: 'image' },
  'image/png': { ext: 'png', maxSize: 15 * MB, kind: 'image' },
  'image/gif': { ext: 'gif', maxSize: 15 * MB, kind: 'image' },
  'image/webp': { ext: 'webp', maxSize: 15 * MB, kind: 'image' },
  'image/avif': { ext: 'avif', maxSize: 15 * MB, kind: 'image' },
  'image/heic': { ext: 'heic', maxSize: 15 * MB, kind: 'image' },
  'image/heif': { ext: 'heif', maxSize: 15 * MB, kind: 'image' },

  // Audio recordings and audio-only campaign responses.
  'audio/mpeg': { ext: 'mp3', maxSize: 50 * MB, kind: 'audio' },
  'audio/mp4': { ext: 'm4a', maxSize: 50 * MB, kind: 'audio' },
  'audio/aac': { ext: 'aac', maxSize: 50 * MB, kind: 'audio' },
  'audio/wav': { ext: 'wav', maxSize: 50 * MB, kind: 'audio' },
  'audio/webm': { ext: 'weba', maxSize: 50 * MB, kind: 'audio' },
  'audio/ogg': { ext: 'oga', maxSize: 50 * MB, kind: 'audio' },
  'audio/flac': { ext: 'flac', maxSize: 50 * MB, kind: 'audio' },
};

const MIME_ALIASES = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/x-flac': 'audio/flac',
};

const EXTENSION_MIME = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  avi: 'video/x-msvideo',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  wave: 'audio/wav',
  oga: 'audio/ogg',
  weba: 'audio/webm',
  flac: 'audio/flac',
};

function cleanMime(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

export function getExtension(filename) {
  const clean = String(filename || '').split('?')[0].split('#')[0];
  const basename = clean.split('/').pop() || '';
  if (!basename.includes('.')) return '';
  return basename.split('.').pop().toLowerCase();
}

export function resolveUploadType(contentType, filename) {
  const normalized = cleanMime(contentType);
  const canonicalMime = MIME_ALIASES[normalized] || normalized;
  if (ALLOWED_MEDIA_TYPES[canonicalMime]) {
    return { mime: canonicalMime, ...ALLOWED_MEDIA_TYPES[canonicalMime] };
  }

  const inferredMime = EXTENSION_MIME[getExtension(filename)];
  if (inferredMime && ALLOWED_MEDIA_TYPES[inferredMime]) {
    return { mime: inferredMime, ...ALLOWED_MEDIA_TYPES[inferredMime] };
  }

  return null;
}

export function supportedMediaTypes() {
  return Object.entries(ALLOWED_MEDIA_TYPES).map(([mime, config]) => ({
    mime,
    extension: config.ext,
    kind: config.kind,
    max_size_mb: Math.round(config.maxSize / MB),
  }));
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return { unsatisfiable: true };

  let start;
  let end;
  if (match[1] === '' && match[2] !== '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return { unsatisfiable: true };
  }

  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1, end };
}

export async function r2MediaResponse(bucket, key, request, fallbackContentType, cacheControl = 'public, max-age=31536000, immutable') {
  const head = await bucket.head(key);
  if (!head) return null;

  const range = parseRange(request.headers.get('Range'), head.size);
  if (range?.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${head.size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const object = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return null;

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || fallbackContentType || head.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', cacheControl);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(range ? range.length : head.size));
  headers.set('X-Content-Type-Options', 'nosniff');
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.end}/${head.size}`);
  }

  return new Response(object.body, { status: range ? 206 : 200, headers });
}
