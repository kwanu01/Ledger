import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/teamledger', '/guides', '/privacy', '/updates'].map(path => ({
    url: `https://teamledger.net${path}`,
  }));
}
