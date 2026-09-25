export interface BniSiteLanguage {
  /** Locale parsed from the URL, e.g. "fr", "de-CH", "en-GB" — no internal numeric ID needed (see design §3.1). */
  locale: string;
  /** The public "find a member" page for this language variant. */
  findMemberUrl: string;
}

export interface BniSite {
  /** Stable key, e.g. "de", "at", "ch", "fr", "us-wisconsin". */
  id: string;
  /** Groups sites for country-scoped queries. A site spanning two countries gets two BniSite entries (see Task 2 Context). */
  countryCode: string;
  /** Human label, e.g. "Deutschland", "Frankreich", "Wisconsin". */
  label: string;
  /** Derived from languages[0].findMemberUrl's origin — never hand-typed. */
  baseUrl: string;
  /** First entry is the default language for this site. */
  languages: BniSiteLanguage[];
}

export interface BniSiteConfig {
  websiteId: string;
  /** Comma-joined if the underlying site itself uses more than one internal country ID. */
  countryIds: string;
}
