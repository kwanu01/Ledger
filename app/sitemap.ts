import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/chagok', '/demo', '/guides/shared-expenses', '/privacy', '/updates'].map(path => ({
    url: `https://teamledger.net${path}`,
  }));
}
