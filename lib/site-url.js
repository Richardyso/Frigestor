/**
 * lib/site-url.js — URL canonica do site (emails, /env, QR codes).
 */

const PRODUCTION_SITE_URL = 'https://frigestor.vercel.app';

function isRunningOnVercel() {
  return Boolean(process.env.VERCEL);
}

function isLocalHostUrl(url) {
  return /localhost|127\.0\.0\.1/i.test(String(url || ''));
}

function resolveSiteUrl() {
  const configured = process.env.BASE_URL && String(process.env.BASE_URL).trim();

  if (configured && !isLocalHostUrl(configured)) {
    return configured.replace(/\/$/, '');
  }

  if (isRunningOnVercel() || process.env.NODE_ENV === 'production') {
    return PRODUCTION_SITE_URL;
  }

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

function pageUrl(relativePath) {
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${resolveSiteUrl()}${path}`;
}

module.exports = {
  PRODUCTION_SITE_URL,
  resolveSiteUrl,
  pageUrl
};
