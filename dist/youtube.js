'use strict';

const RESERVED_TWITCH_PATHS = new Set([
  'directory', 'downloads', 'jobs', 'settings', 'inventory', 'wallet',
  'subscriptions', 'drops', 'turbo', 'videos', 'search', 'login',
  'signup', 'popout', 'p', 'u', 'store', 'friends', 'moderator',
  'activate', 'payments', 'prime', 'team',
]);

function youtubeVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const path = url.pathname.split('/').filter(Boolean);
    let videoId;
    if (url.hostname === 'youtu.be' && path.length === 1) {
      [videoId] = path;
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v');
      else if (path.length === 2 && ['shorts', 'live', 'embed'].includes(path[0])) videoId = path[1];
    }
    return typeof videoId === 'string' && /^[\w-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}

/**
 * Parse a YouTube or Twitch URL (VOD, Clip, or live channel stream) into a
 * normalized source descriptor usable by both browser UI and Node backend.
 */
function parseVideoSource(rawUrl) {
  const ytId = youtubeVideoId(rawUrl);
  if (ytId) {
    const isYtLivePath = /youtube\.com\/live\//i.test(rawUrl);
    return {
      platform: 'youtube',
      kind: isYtLivePath ? 'live' : 'video',
      videoId: ytId,
      url: `https://www.youtube.com/watch?v=${ytId}`,
      label: `youtube.com/watch?v=${ytId}`,
    };
  }
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.split('/').filter(Boolean);

    if (host === 'clips.twitch.tv' && path.length === 1 && /^[\w-]+$/.test(path[0])) {
      const slug = path[0];
      return {
        platform: 'twitch',
        kind: 'clip',
        slug,
        videoId: `twitch-clip-${slug}`,
        url: `https://clips.twitch.tv/${slug}`,
        label: `clips.twitch.tv/${slug}`,
      };
    }

    if (['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(host) && path.length >= 1) {
      if (path.length >= 2 && path[0] === 'videos' && /^\d+$/.test(path[1])) {
        const twitchId = path[1];
        return {
          platform: 'twitch',
          kind: 'vod',
          twitchId,
          videoId: `twitch-vod-${twitchId}`,
          url: `https://www.twitch.tv/videos/${twitchId}`,
          label: `twitch.tv/videos/${twitchId}`,
        };
      }
      if (path.length >= 3 && path[1] === 'video' && /^\d+$/.test(path[2])) {
        const twitchId = path[2];
        return {
          platform: 'twitch',
          kind: 'vod',
          twitchId,
          videoId: `twitch-vod-${twitchId}`,
          url: `https://www.twitch.tv/videos/${twitchId}`,
          label: `twitch.tv/videos/${twitchId}`,
        };
      }
      if (path.length >= 3 && path[1] === 'clip' && /^[\w-]+$/.test(path[2])) {
        const channel = path[0].toLowerCase();
        const slug = path[2];
        return {
          platform: 'twitch',
          kind: 'clip',
          channel,
          slug,
          videoId: `twitch-clip-${slug}`,
          url: `https://www.twitch.tv/${channel}/clip/${slug}`,
          label: `twitch.tv/${channel}/clip/${slug}`,
        };
      }
      if (path.length === 1 && /^[a-zA-Z0-9_]{2,25}$/.test(path[0]) && !RESERVED_TWITCH_PATHS.has(path[0].toLowerCase())) {
        const channel = path[0].toLowerCase();
        return {
          platform: 'twitch',
          kind: 'live',
          channel,
          videoId: `twitch-live-${channel}`,
          url: `https://www.twitch.tv/${channel}`,
          label: `twitch.tv/${channel}`,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive display URL, platform, and short pill label from either a job object
 * or a raw videoId string (supporting legacy YouTube jobs seamlessly).
 */
function sourceFromJob(jobOrId) {
  if (!jobOrId) return { platform: 'youtube', kind: 'video', videoId: '', url: '', label: '' };
  if (typeof jobOrId === 'string') {
    const parsed = parseVideoSource(jobOrId);
    if (parsed) return parsed;
    if (/^[\w-]{11}$/.test(jobOrId)) {
      return {
        platform: 'youtube',
        kind: 'video',
        videoId: jobOrId,
        url: `https://www.youtube.com/watch?v=${jobOrId}`,
        label: `youtube.com/watch?v=${jobOrId}`,
      };
    }
    return { platform: 'youtube', kind: 'video', videoId: jobOrId, url: '', label: jobOrId };
  }
  const directUrl = jobOrId.url || jobOrId.sourceUrl;
  if (directUrl) {
    const parsed = parseVideoSource(directUrl);
    if (parsed) return { ...parsed, videoId: jobOrId.videoId || parsed.videoId };
    return {
      platform: jobOrId.sourcePlatform || 'youtube',
      kind: jobOrId.sourceKind || 'video',
      videoId: jobOrId.videoId || '',
      url: directUrl,
      label: directUrl.replace(/^https?:\/\/(www\.)?/, ''),
    };
  }
  if (typeof jobOrId.videoId === 'string') {
    if (jobOrId.videoId.startsWith('twitch-vod-')) {
      const id = jobOrId.videoId.slice('twitch-vod-'.length);
      return {
        platform: 'twitch', kind: 'vod', twitchId: id, videoId: jobOrId.videoId,
        url: `https://www.twitch.tv/videos/${id}`, label: `twitch.tv/videos/${id}`,
      };
    }
    if (jobOrId.videoId.startsWith('twitch-live-')) {
      const ch = jobOrId.videoId.slice('twitch-live-'.length);
      return {
        platform: 'twitch', kind: 'live', channel: ch, videoId: jobOrId.videoId,
        url: `https://www.twitch.tv/${ch}`, label: `twitch.tv/${ch}`,
      };
    }
    if (jobOrId.videoId.startsWith('twitch-clip-')) {
      const slug = jobOrId.videoId.slice('twitch-clip-'.length);
      return {
        platform: 'twitch', kind: 'clip', slug, videoId: jobOrId.videoId,
        url: `https://clips.twitch.tv/${slug}`, label: `clips.twitch.tv/${slug}`,
      };
    }
    if (/^[\w-]{11}$/.test(jobOrId.videoId)) {
      return {
        platform: 'youtube', kind: 'video', videoId: jobOrId.videoId,
        url: `https://www.youtube.com/watch?v=${jobOrId.videoId}`,
        label: `youtube.com/watch?v=${jobOrId.videoId}`,
      };
    }
  }
  return { platform: 'youtube', kind: 'video', videoId: jobOrId.videoId || '', url: '', label: '' };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { youtubeVideoId, parseVideoSource, sourceFromJob };
}
