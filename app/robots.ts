import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', '/account', '/teams', '/l/', '/join/', '/login'] },
    sitemap: 'https://teamledger.net/sitemap.xml',
  };
}
