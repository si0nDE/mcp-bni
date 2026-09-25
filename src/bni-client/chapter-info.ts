import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteLanguage } from '../registry/types';

export interface BniChapterInfo {
  name: string;
  meetingDay?: string;
  meetingTime?: string;
  meetingType?: string;
  meetingDuration?: number;
  locationName?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  regionName?: string;
  phoneNumber?: string;
  totalMemberCount?: number;
  onlineMeetingLink?: string;
  chapterUrl?: string;
  visitChapterUrl?: string;
}

interface ChapterInfoResponse {
  content?: {
    chapterDetails?: {
      name?: string;
      meetingDay?: string;
      meetingTime?: string;
      meetingTypeText?: string;
      meetingDuration?: number;
      locationName?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      postalCode?: string;
      regionName?: string;
      phoneNumber?: string;
      totalMemberCount?: number;
      onlineMeetingLink?: string;
      chapterUrl?: string;
      visitChapterUrl?: string;
    };
  };
}

/** Fetches a chapter's public meeting logistics via its encoded chapter id (see design §3/member-detail's `chapterId` output). */
export async function getChapterInfo(
  site: BniSite,
  encodedChapterId: string,
  language?: BniSiteLanguage
): Promise<BniChapterInfo | null> {
  const lang = language ?? site.languages[0];
  const params = new URLSearchParams();
  params.set('encodedChapterId', encodedChapterId);
  params.set('locale', lang.locale);

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/consume/chapterInfo/?${params.toString()}`);
  if (!res.ok) return null;

  const data = (await res.json()) as ChapterInfoResponse;
  const d = data.content?.chapterDetails;
  if (!d?.name) return null;

  const address = [d.addressLine1, d.addressLine2].filter(Boolean).join(', ') || undefined;

  return {
    name: d.name,
    meetingDay: d.meetingDay || undefined,
    meetingTime: d.meetingTime || undefined,
    meetingType: d.meetingTypeText || undefined,
    meetingDuration: d.meetingDuration,
    locationName: d.locationName || undefined,
    address,
    city: d.city || undefined,
    postalCode: d.postalCode || undefined,
    regionName: d.regionName || undefined,
    phoneNumber: d.phoneNumber || undefined,
    totalMemberCount: d.totalMemberCount,
    onlineMeetingLink: d.onlineMeetingLink || undefined,
    chapterUrl: d.chapterUrl || undefined,
    visitChapterUrl: d.visitChapterUrl || undefined,
  };
}
