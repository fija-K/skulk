export interface ParsedMedia {
  platform: 'youtube' | 'vimeo' | 'dailymotion' | 'twitch';
  videoId: string;
  isLive?: boolean;
}

export function parseMediaUrl(url: string): ParsedMedia | null {
  const cleanUrl = url.trim();
  if (!cleanUrl) return null;

  // 1. YouTube (Video and Playlist support)
  const isYtDomain = cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be');
  if (isYtDomain) {
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const ytMatch = cleanUrl.match(ytRegex);
    const videoId = ytMatch ? ytMatch[1] : '';

    const playlistRegex = /[?&]list=([^#\&\?]+)/;
    const playlistMatch = cleanUrl.match(playlistRegex);
    const playlistId = playlistMatch ? playlistMatch[1] : '';

    if (playlistId) {
      return { platform: 'youtube', videoId: `playlist:${playlistId}${videoId ? ':' + videoId : ''}` };
    }
    if (videoId) {
      return { platform: 'youtube', videoId };
    }
  }

  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
    return { platform: 'youtube', videoId: cleanUrl };
  }

  // 2. Vimeo
  const vimeoRegex = /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/;
  const vimeoMatch = cleanUrl.match(vimeoRegex);
  if (vimeoMatch) {
    return { platform: 'vimeo', videoId: vimeoMatch[1] };
  }

  // 3. Dailymotion
  const dmRegex = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([a-zA-Z0-9]+)/;
  const dmMatch = cleanUrl.match(dmRegex);
  if (dmMatch) {
    return { platform: 'dailymotion', videoId: dmMatch[1] };
  }

  // 4. Twitch
  const twitchVodRegex = /twitch\.tv\/videos\/(\d+)/;
  const twitchVodMatch = cleanUrl.match(twitchVodRegex);
  if (twitchVodMatch) {
    return { platform: 'twitch', videoId: twitchVodMatch[1], isLive: false };
  }

  const twitchChannelRegex = /twitch\.tv\/([a-zA-Z0-9_]+)/;
  const twitchChannelMatch = cleanUrl.match(twitchChannelRegex);
  if (twitchChannelMatch) {
    const channel = twitchChannelMatch[1].toLowerCase();
    const reservedWords = ['directory', 'videos', 'u', 'moderator', 'popout', 'search'];
    if (!reservedWords.includes(channel)) {
      return { platform: 'twitch', videoId: twitchChannelMatch[1], isLive: true };
    }
  }

  return null;
}

export function isDrmBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('netflix.com') || 
         lower.includes('disneyplus.com') || 
         lower.includes('amazon.com/gp/video') || 
         lower.includes('primevideo.com') ||
         lower.includes('hulu.com') ||
         lower.includes('max.com') ||
         lower.includes('hbo.com');
}

// Module-level cache variables for loaded APIs (Singletons)
let ytApiPromise: Promise<void> | null = null;
export function loadYoutubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  
  ytApiPromise = new Promise((resolve) => {
    if ((window as any).YT && (window as any).YT.Player) {
      resolve();
      return;
    }
    
    const prevCallback = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  
  return ytApiPromise;
}

let vimeoApiPromise: Promise<void> | null = null;
export function loadVimeoApi(): Promise<void> {
  if (vimeoApiPromise) return vimeoApiPromise;
  
  vimeoApiPromise = new Promise((resolve) => {
    if ((window as any).Vimeo) {
      resolve();
      return;
    }
    
    const tag = document.createElement('script');
    tag.src = 'https://player.vimeo.com/api/player.js';
    tag.onload = () => resolve();
    tag.onerror = () => resolve();
    document.head.appendChild(tag);
  });
  
  return vimeoApiPromise;
}

let twitchApiPromise: Promise<void> | null = null;
export function loadTwitchApi(): Promise<void> {
  if (twitchApiPromise) return twitchApiPromise;
  
  twitchApiPromise = new Promise((resolve) => {
    if ((window as any).Twitch && (window as any).Twitch.Player) {
      resolve();
      return;
    }
    
    const tag = document.createElement('script');
    tag.src = 'https://player.twitch.tv/js/embed/v1.js';
    tag.onload = () => resolve();
    tag.onerror = () => resolve();
    document.head.appendChild(tag);
  });
  
  return twitchApiPromise;
}

let dailymotionApiPromise: Promise<void> | null = null;
export function loadDailymotionApi(): Promise<void> {
  if (dailymotionApiPromise) return dailymotionApiPromise;
  
  dailymotionApiPromise = new Promise((resolve) => {
    if ((window as any).dailymotion) {
      resolve();
      return;
    }
    
    const tag = document.createElement('script');
    tag.src = 'https://geo.dailymotion.com/libs/player/x508t.js';
    tag.onload = () => resolve();
    tag.onerror = () => resolve();
    document.head.appendChild(tag);
  });
  
  return dailymotionApiPromise;
}
