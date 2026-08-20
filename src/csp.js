// CSP for HTML documents (the React SPA). Media/images may come from R2 or
// external https hosts (e.g. campaign photo CDNs), so img/media allow https.
// Embedded political ads are limited to privacy-mode YouTube and Vimeo.
// The redesign imports Google Fonts; keep that allowance explicit instead of
// widening all style/font sources.
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "connect-src 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "child-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
