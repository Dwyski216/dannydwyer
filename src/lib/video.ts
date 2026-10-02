// Small shared helpers so every page treats YouTube and Vimeo videos the
// same way. Adding a third platform later just means adding a case here.

// The Work grid's display order: admin-set `order` first (lower = earlier),
// falling back to uploadDate (newest first) as a tiebreaker — every video
// defaults to order: 0, so an un-reordered catalog sorts exactly as it did
// before this field existed.
export function byDisplayOrder(a: { order: number; uploadDate: string }, b: { order: number; uploadDate: string }): number {
  if (a.order !== b.order) return a.order - b.order;
  return new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
}

export type VideoPlatform = 'youtube' | 'vimeo';

export interface VideoSource {
  platform: VideoPlatform;
  videoId: string;
  thumbnailUrl?: string;
}

export function getEmbedUrl({ platform, videoId }: VideoSource): string {
  if (platform === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${videoId}`;
  }
  // dnt=1 opts Vimeo's player out of its own analytics tracking, similar in
  // spirit to using youtube-nocookie.com above; title/byline/portrait=0
  // strip Vimeo's own chrome so the embed matches the site's own frame.
  return `https://player.vimeo.com/video/${videoId}?dnt=1&title=0&byline=0&portrait=0`;
}

const PLACEHOLDER_THUMBNAIL = '/images/video-placeholder.png';

/**
 * Resolve a thumbnail for a video.
 *
 * YouTube thumbnails are derivable directly from the video ID, no network
 * call needed. Vimeo doesn't expose a predictable thumbnail URL pattern, so
 * we either use an explicit `thumbnailUrl` from the frontmatter, or fall
 * back to Vimeo's oEmbed endpoint at build time (this runs once per video
 * during `astro build`, not in the browser, so it doesn't slow down the
 * live site). Falls back to a placeholder image if that call fails for any
 * reason (private video, bad ID, network hiccup) so one bad entry never
 * breaks the whole build.
 */
export async function getThumbnailUrl(source: VideoSource): Promise<string> {
  if (source.thumbnailUrl) return source.thumbnailUrl;

  if (source.platform === 'youtube') {
    return `https://i.ytimg.com/vi/${source.videoId}/hqdefault.jpg`;
  }

  try {
    const res = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${source.videoId}`)}`
    );
    if (!res.ok) throw new Error(`oEmbed request failed: ${res.status}`);
    const data = (await res.json()) as { thumbnail_url?: string };
    return data.thumbnail_url ?? PLACEHOLDER_THUMBNAIL;
  } catch {
    return PLACEHOLDER_THUMBNAIL;
  }
}
