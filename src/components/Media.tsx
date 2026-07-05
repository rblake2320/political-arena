import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, FileAudio, FileVideo, Image as ImageIcon, Link as LinkIcon, Upload, X } from 'lucide-react';
import * as api from '../api';

type MediaKind = 'image' | 'video' | 'audio' | 'embed' | 'link' | 'unknown';

const ACCEPTED_MEDIA = [
  'video/*',
  'audio/*',
  'image/*',
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.ogv',
  '.ogg',
  '.3gp',
  '.3g2',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.flac',
  '.oga',
  '.weba',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
].join(',');

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg', '3gp', '3g2']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'oga', 'weba']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif']);

const SIZE_LIMITS_MB: Record<MediaKind, number> = {
  image: 15,
  video: 100,
  audio: 50,
  embed: 0,
  link: 0,
  unknown: 15,
};

function formatSize(bytes: number) {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function extensionFromUrl(value: string) {
  try {
    const parsed = new URL(value, window.location.origin);
    const filename = parsed.pathname.split('/').pop() || '';
    return filename.includes('.') ? filename.split('.').pop()?.toLowerCase() || '' : '';
  } catch {
    const clean = value.split('?')[0].split('#')[0];
    return clean.includes('.') ? clean.split('.').pop()?.toLowerCase() || '' : '';
  }
}

function mediaKindFromMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'unknown';
}

function mediaKindFromExtension(ext: string): MediaKind {
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'unknown';
}

function getYouTubeId(url: string) {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function getVimeoId(url: string) {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : null;
}

export function inferMediaKind(url: string, mediaType?: string): MediaKind {
  if (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio') return mediaType;
  if (getYouTubeId(url) || getVimeoId(url)) return 'embed';
  const ext = extensionFromUrl(url);
  const kind = mediaKindFromExtension(ext);
  return kind === 'unknown' ? 'link' : kind;
}

function iconForKind(kind: MediaKind) {
  if (kind === 'image') return <ImageIcon className="w-5 h-5 text-zinc-400" />;
  if (kind === 'audio') return <FileAudio className="w-5 h-5 text-zinc-400" />;
  if (kind === 'video') return <FileVideo className="w-5 h-5 text-zinc-400" />;
  return <LinkIcon className="w-5 h-5 text-zinc-400" />;
}

type Preview = {
  name: string;
  size: string;
  type: string;
  kind: MediaKind;
  url?: string;
  localUrl?: string;
};

export function MediaUploadField({
  onMediaUrl,
  candidateId,
  label,
}: {
  onMediaUrl: (url: string) => void;
  candidateId?: string;
  label?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pasteUrl, setPasteUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      if (preview?.localUrl) URL.revokeObjectURL(preview.localUrl);
    };
  }, [preview?.localUrl]);

  const clearPreview = () => {
    if (preview?.localUrl) URL.revokeObjectURL(preview.localUrl);
    setPreview(null);
    onMediaUrl('');
  };

  const handleFile = async (file: File) => {
    if (!file) return;
    setError('');

    const kind = mediaKindFromMime(file.type) !== 'unknown'
      ? mediaKindFromMime(file.type)
      : mediaKindFromExtension(extensionFromUrl(file.name));
    const maxMB = SIZE_LIMITS_MB[kind] || SIZE_LIMITS_MB.unknown;
    const maxSize = maxMB * 1024 * 1024;
    if (file.size > maxSize) {
      setError(`File too large (${formatSize(file.size)}). Maximum for ${kind === 'unknown' ? 'media' : kind} is ${maxMB}MB.`);
      return;
    }

    const localUrl = URL.createObjectURL(file);
    if (preview?.localUrl) URL.revokeObjectURL(preview.localUrl);
    setPreview({
      name: file.name || 'Selected media',
      size: formatSize(file.size),
      type: file.type || kind,
      kind,
      url: localUrl,
      localUrl,
    });
    setUploading(true);

    try {
      const result = await api.uploadMedia(file, candidateId);
      onMediaUrl(result.url);
    } catch (err: any) {
      setPreview(null);
      setError(err?.response?.data?.error || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handlePaste = () => {
    const url = pasteUrl.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('Only http/https URLs are allowed');
        return;
      }
      const kind = inferMediaKind(url);
      setError('');
      if (preview?.localUrl) URL.revokeObjectURL(preview.localUrl);
      setPreview({ name: parsed.hostname, size: kind === 'link' ? 'Linked media' : 'External media', type: 'link', kind, url });
      onMediaUrl(url);
    } catch {
      setError('Invalid URL format');
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-400 mb-1.5">{label || 'Attach Media'}</label>
      {preview ? (
        <div className={`rounded-lg bg-zinc-950 border ${uploading ? 'border-indigo-500/50 animate-pulse' : 'border-zinc-800'} overflow-hidden`}>
          <div className="p-3 flex items-center gap-3">
            <div className="w-12 h-12 rounded bg-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
              {preview.kind === 'image' && preview.url ? (
                <img src={preview.url} alt="" className="w-full h-full object-cover" />
              ) : (
                iconForKind(preview.kind)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{preview.name}</div>
              <div className="text-xs text-zinc-500">{uploading ? 'Uploading...' : preview.size}</div>
            </div>
            {!uploading && (
              <button type="button" onClick={clearPreview} className="text-zinc-500 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors" aria-label="Remove media">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {preview.url && preview.kind !== 'link' && (
            <div className="border-t border-zinc-800 p-3">
              <ContentMedia url={preview.url} mediaType={preview.kind} compact alt="Selected media preview" />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={handleDrop}
            className={`rounded-lg border border-dashed ${dragActive ? 'border-indigo-400 bg-indigo-500/10' : 'border-zinc-700 bg-zinc-950'} transition-colors`}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 text-sm text-zinc-400 hover:text-zinc-200 disabled:text-zinc-600 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {uploading ? 'Uploading...' : 'Choose or drop video, audio, or image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_MEDIA}
              className="hidden"
              onChange={handleInput}
              disabled={uploading}
            />
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Or paste a media link..."
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              value={pasteUrl}
              onChange={e => setPasteUrl(e.target.value)}
            />
            <button type="button" onClick={handlePaste} disabled={!pasteUrl.trim()} className="px-3 py-2 text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 transition-colors">
              Use
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-xs text-amber-400 mt-1">{error}</div>}
    </div>
  );
}

export function ContentMedia({
  url,
  mediaType,
  alt,
  compact = false,
}: {
  url: string;
  mediaType?: string;
  alt?: string;
  compact?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const youtubeId = getYouTubeId(url);
  const vimeoId = getVimeoId(url);
  const kind = inferMediaKind(url, mediaType);
  const mediaMargin = compact ? '' : 'mb-4';

  if (errored) {
    return (
      <div className={`aspect-video bg-zinc-950 rounded-lg ${mediaMargin} flex items-center justify-center border border-zinc-800`}>
        <div className="text-center p-4">
          <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <div className="text-xs text-zinc-500 mb-2">Media unavailable</div>
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300">
            Open media
          </a>
        </div>
      </div>
    );
  }

  if (youtubeId) {
    return (
      <div className={`aspect-video bg-zinc-950 rounded-lg ${mediaMargin} overflow-hidden border border-zinc-800`}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
          title={alt || 'YouTube video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>
    );
  }

  if (vimeoId) {
    return (
      <div className={`aspect-video bg-zinc-950 rounded-lg ${mediaMargin} overflow-hidden border border-zinc-800`}>
        <iframe
          src={`https://player.vimeo.com/video/${vimeoId}`}
          title={alt || 'Vimeo video'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div className={`aspect-video bg-black rounded-lg ${mediaMargin} overflow-hidden border border-zinc-800`}>
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="w-full h-full object-contain"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className={`bg-zinc-950 rounded-lg ${mediaMargin} p-4 border border-zinc-800`}>
        <audio src={url} controls preload="metadata" className="w-full" onError={() => setErrored(true)} />
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div className={`aspect-video bg-zinc-950 rounded-lg ${mediaMargin} overflow-hidden border border-zinc-800`}>
        <img
          src={url}
          alt={alt || 'Media'}
          className="w-full h-full object-contain"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-3 rounded-lg ${mediaMargin} p-4 border border-zinc-800 bg-zinc-950 hover:border-indigo-500/50 transition-colors`}
    >
      <LinkIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />
      <span className="text-sm text-zinc-200 truncate">{url}</span>
    </a>
  );
}
