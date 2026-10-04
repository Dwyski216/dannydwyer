import { defineCollection, z } from 'astro:content';

const videos = defineCollection({
  type: 'content',
  schema: z.object({
    // Core content
    title: z.string(),
    // Short version for <meta description> and search/AI snippets — aim for 150-160 characters.
    summary: z.string().max(200),
    // Longer on-page description, can be a full paragraph or two. Written in the body (markdown) below the frontmatter.

    // Video embed — hosted on YouTube or Vimeo, never uploaded to this site
    platform: z.enum(['youtube', 'vimeo']).default('youtube'),
    videoId: z.string(), // YouTube video ID (e.g. "dQw4w9WgXcQ") or Vimeo numeric ID (e.g. "76979871")
    thumbnailUrl: z.string().optional(), // required for Vimeo (no public thumbnail URL pattern); optional override for YouTube

    // Still images from the shoot, shown as a gallery on the video's page.
    stills: z
      .array(
        z.object({
          src: z.string(), // path under /public, e.g. "/images/videos/midnight-harbor/01.jpg"
          alt: z.string(),
          caption: z.string().optional(),
        })
      )
      .default([]),

    // Production facts — these power the VideoObject / CreativeWork structured data
    // and are the kind of concrete, extractable facts AI answer engines favor.
    // A flexible, ordered list of who worked on this and in what capacity —
    // not just Danny's own role, so a project with a separate editor,
    // producer, etc. can credit them too. Order is display order.
    credits: z
      .array(
        z.object({
          role: z.string(),
          name: z.string(),
        })
      )
      .default([]),
    // A flexible, ordered list of gear used on the shoot — same shape and
    // admin mechanism as credits (add/remove/reorder rows), just category +
    // item instead of role + name.
    equipment: z
      .array(
        z.object({
          category: z.string(),
          item: z.string(),
        })
      )
      .default([]),
    client: z.string().optional(), // e.g. "A24" or "Independent"
    projectName: z.string().optional(), // e.g. "Midnight Harbor (short film)"
    uploadDate: z.string(), // ISO date, e.g. "2026-03-14" — used for both display and schema
    durationISO: z.string().optional(), // ISO 8601 duration, e.g. "PT4M32S" — optional, nice-to-have for schema

    // Organization / discovery
    tags: z.array(z.string()).default([]),
    urlSlug: z.string(), // controls the final URL: /work/[slug]
    hidden: z.boolean().default(false), // true = still has its own page, but excluded from /work and llms.txt (e.g. a temporary home-page reel)

    // Manual display order for the Work grid and llms.txt (lower = earlier).
    // Admin-settable via up/down move, which swaps this value between two
    // adjacent items — see worker/index.ts's reorder handler. Ties fall
    // back to uploadDate (newest first).
    order: z.number().default(0),
  }),
});

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string().max(200).optional(), // meta description for static pages
  }),
});

export const collections = { videos, pages };
