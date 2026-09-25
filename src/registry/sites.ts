import { BniSite, BniSiteLanguage } from './types';

type SiteSeed = Omit<BniSite, 'baseUrl'>;

function withBaseUrl(seed: SiteSeed): BniSite {
  return { ...seed, baseUrl: new URL(seed.languages[0].findMemberUrl).origin };
}

const SITE_SEEDS: SiteSeed[] = [
  // Germany + Austria share one member database (countryIds "5723,5768" in
  // the old project's hardcoded config) — represented as two entries over
  // the same URL, per this task's Context.
  //
  // Task 11 live-verification bug fix (2026-09-25): the design-research URL
  // "https://bni.de/de-DE/findamember" now 301-redirects to the bare
  // homepage "/de/index" (confirmed via curl -IL), which has no
  // countryIds/website_id inputs — every Task 11 fan-out tool failed for
  // "DE" with "no <input name=\"countryIds\"> found". The live site was
  // restructured to serve the find-member form at "/de/mitgliedfinden"
  // instead; fetching that path confirms website_id="7198" and
  // countryIds="5723,5768" — the exact same values named in the comment
  // above, so this is the same site/database, just moved, not a different
  // one. Updated both entries to the working URL.
  {
    id: 'de',
    countryCode: 'DE',
    label: 'Germany',
    languages: [{ locale: 'de-DE', findMemberUrl: 'https://bni.de/de/mitgliedfinden' }],
  },
  {
    id: 'at',
    countryCode: 'AT',
    label: 'Austria',
    languages: [{ locale: 'de-DE', findMemberUrl: 'https://bni.de/de/mitgliedfinden' }],
  },
  // Switzerland: one site, three language variants (confirmed pattern from
  // the previous mcp-bni implementation's BNI_COUNTRIES.ch entry).
  {
    id: 'ch',
    countryCode: 'CH',
    label: 'Switzerland & Liechtenstein',
    languages: [
      { locale: 'de-CH', findMemberUrl: 'https://bni.swiss/de-CH/findamember' },
      { locale: 'fr-CH', findMemberUrl: 'https://bni.swiss/fr-CH/findamember' },
      { locale: 'it-CH', findMemberUrl: 'https://bni.swiss/it-CH/findamember' },
    ],
  },
  {
    id: 'fr',
    countryCode: 'FR',
    label: 'France',
    languages: [{ locale: 'fr', findMemberUrl: 'https://bnifrance.fr/fr/trouverunmembre' }],
  },
  {
    id: 'jp',
    countryCode: 'JP',
    label: 'Japan',
    languages: [{ locale: 'ja', findMemberUrl: 'https://bni.jp/ja/findamember' }],
  },
  {
    id: 'gr',
    countryCode: 'GR',
    label: 'Greece',
    languages: [{ locale: 'el', findMemberUrl: 'https://bni.bni-greece.com/el/findamember' }],
  },

  // --- Europa (remaining) ---
  {
    id: 'gb',
    countryCode: 'GB',
    label: 'United Kingdom',
    languages: [{ locale: 'en-GB', findMemberUrl: 'https://bni.co.uk/en-GB/findamember' }],
  },
  {
    id: 'ie',
    countryCode: 'IE',
    label: 'Ireland',
    languages: [{ locale: 'en-IE', findMemberUrl: 'https://bni.ie/en-IE/findamember' }],
  },
  // Belgium: two independent regional sites on different domains (Flemish
  // and French-speaking communities), not one shared database — modeled as
  // two BniSite entries over the same countryCode, like a region within a
  // country (design §3.2), rather than as language variants of one site.
  {
    id: 'be-nl',
    countryCode: 'BE',
    label: 'Belgium (Flemish)',
    languages: [{ locale: 'nl', findMemberUrl: 'https://bni-vlaanderen.be/nl/zoekeenlid' }],
  },
  {
    id: 'be-fr',
    countryCode: 'BE',
    label: 'Belgium (French)',
    languages: [{ locale: 'fr', findMemberUrl: 'https://bnibelgique.be/fr/trouverunmembre' }],
  },
  {
    id: 'nl',
    countryCode: 'NL',
    label: 'Netherlands',
    languages: [{ locale: 'nl', findMemberUrl: 'https://bni-nederland.nl/nl/zoekeenlid' }],
  },
  {
    id: 'lu',
    countryCode: 'LU',
    label: 'Luxembourg',
    languages: [{ locale: 'fr', findMemberUrl: 'https://bniluxembourg.lu/fr/trouverunmembre' }],
  },
  {
    id: 'pt',
    countryCode: 'PT',
    label: 'Portugal',
    languages: [{ locale: 'pt', findMemberUrl: 'https://bni-portugal.com/pt/findamember' }],
  },
  {
    id: 'it',
    countryCode: 'IT',
    label: 'Italy',
    languages: [{ locale: 'en-GB', findMemberUrl: 'https://bni-italia.com/en-GB/findamember' }],
  },
  {
    id: 'se',
    countryCode: 'SE',
    label: 'Sweden',
    languages: [{ locale: 'sv', findMemberUrl: 'https://bni.nu/sv/vemarmed' }],
  },
  {
    id: 'dk',
    countryCode: 'DK',
    label: 'Denmark',
    languages: [{ locale: 'da', findMemberUrl: 'https://bni.as/da/findforretningspartner' }],
  },
  {
    id: 'no',
    countryCode: 'NO',
    label: 'Norway',
    languages: [{ locale: 'nb', findMemberUrl: 'https://bni.no/nb/finnenforretningspartner' }],
  },
  {
    id: 'fi',
    countryCode: 'FI',
    label: 'Finland',
    languages: [{ locale: 'fi', findMemberUrl: 'https://bni.fi/fi/etsiliikekumppani' }],
  },
  {
    id: 'pl',
    countryCode: 'PL',
    label: 'Poland',
    // The URL itself carries no language segment (https://bnipolska.pl/znajdz-osobe/);
    // judgment call: locale set to "pl" to match the site's sole (Polish) language.
    languages: [{ locale: 'pl', findMemberUrl: 'https://bnipolska.pl/znajdz-osobe/' }],
  },
  {
    id: 'cz',
    countryCode: 'CZ',
    label: 'Czechia',
    languages: [{ locale: 'cs', findMemberUrl: 'https://bni-czechia.com/cs/findamember' }],
  },
  {
    id: 'sk',
    countryCode: 'SK',
    label: 'Slovakia',
    // Source is HTTP-only in the research doc (HTTPS has a certificate error) — transcribed as-is.
    languages: [{ locale: 'sk-SK', findMemberUrl: 'http://bni.sk/sk-SK/findamember' }],
  },
  {
    id: 'hu',
    countryCode: 'HU',
    label: 'Hungary',
    languages: [{ locale: 'hu-HU', findMemberUrl: 'https://bni-hungary.com/hu-HU/findamember' }],
  },
  {
    id: 'ro',
    countryCode: 'RO',
    label: 'Romania',
    languages: [{ locale: 'ro-RO', findMemberUrl: 'https://bni-romania.com/ro-RO/gasesteunmembru' }],
  },
  {
    id: 'hr',
    countryCode: 'HR',
    label: 'Croatia',
    languages: [{ locale: 'hr-HR', findMemberUrl: 'https://bni-croatia.com/hr-HR/findamember' }],
  },
  {
    id: 'si',
    countryCode: 'SI',
    label: 'Slovenia',
    languages: [{ locale: 'sl', findMemberUrl: 'https://bni-slovenia.com/sl/findamember' }],
  },
  {
    id: 'rs',
    countryCode: 'RS',
    label: 'Serbia',
    // HTTP-only, transcribed as-is from the research doc.
    languages: [{ locale: 'sr-Latn-RS', findMemberUrl: 'http://bni-serbia.com/sr-Latn-RS/findamember' }],
  },
  {
    id: 'bg',
    countryCode: 'BG',
    label: 'Bulgaria',
    languages: [{ locale: 'bg', findMemberUrl: 'https://bni.bg/bg/findamember' }],
  },
  {
    id: 'lv',
    countryCode: 'LV',
    label: 'Latvia',
    languages: [{ locale: 'lv', findMemberUrl: 'https://bni.lv/lv/findamember' }],
  },
  {
    id: 'lt',
    countryCode: 'LT',
    label: 'Lithuania',
    languages: [{ locale: 'en', findMemberUrl: 'https://bni.lt/en/findamember' }],
  },
  {
    id: 'ee',
    countryCode: 'EE',
    label: 'Estonia',
    languages: [{ locale: 'et', findMemberUrl: 'https://bni.ee/et/leialiige' }],
  },
  {
    id: 'tr',
    countryCode: 'TR',
    label: 'Turkey',
    languages: [{ locale: 'tr', findMemberUrl: 'https://bni.com.tr/tr/findamember' }],
  },

  // --- Nordamerika ---
  // Canada: one site (bnicanada.ca), two language variants — same pattern as
  // Switzerland (single shared domain/database, multiple languages).
  {
    id: 'ca',
    countryCode: 'CA',
    label: 'Canada',
    languages: [
      { locale: 'en-CA', findMemberUrl: 'https://bnicanada.ca/en-CA/findamember' },
      { locale: 'fr-CA', findMemberUrl: 'https://bnicanada.ca/fr-CA/findamember' },
    ],
  },

  // --- Lateinamerika ---
  {
    id: 'mx',
    countryCode: 'MX',
    label: 'Mexico',
    languages: [{ locale: 'es-MX', findMemberUrl: 'https://bnimexico.com/es-MX/encuentraunmiembro' }],
  },
  {
    id: 'co',
    countryCode: 'CO',
    label: 'Colombia',
    languages: [{ locale: 'es-CO', findMemberUrl: 'https://bnicolombia.com/es-CO/encuentra-un-miembro' }],
  },
  {
    id: 'pe',
    countryCode: 'PE',
    label: 'Peru',
    languages: [{ locale: 'es-PE', findMemberUrl: 'https://bniperu.com/es-PE/encontrarunmiembro' }],
  },
  {
    id: 'cl',
    countryCode: 'CL',
    label: 'Chile',
    // HTTP-only, transcribed as-is from the research doc.
    languages: [{ locale: 'es-CL', findMemberUrl: 'http://bnichile.com/es-CL/findamember' }],
  },
  {
    id: 'cr',
    countryCode: 'CR',
    label: 'Costa Rica',
    languages: [{ locale: 'es-CR', findMemberUrl: 'https://bnicostarica.com/es-CR/encontrarmiembro' }],
  },
  {
    id: 'gt',
    countryCode: 'GT',
    label: 'Guatemala',
    // HTTP-only; locale segment in the URL is es-MX even though the country is Guatemala — transcribed as-is.
    languages: [{ locale: 'es-MX', findMemberUrl: 'http://bniguatemala.com/es-MX/findamember' }],
  },

  // --- Middle East & Africa ---
  {
    id: 'il',
    countryCode: 'IL',
    label: 'Israel',
    languages: [{ locale: 'iw', findMemberUrl: 'https://bni.co.il/iw/findamember' }],
  },
  {
    id: 'ae',
    countryCode: 'AE',
    label: 'United Arab Emirates',
    languages: [{ locale: 'en-AE', findMemberUrl: 'https://bni.ae/en-AE/findamember' }],
  },
  {
    id: 'om',
    countryCode: 'OM',
    label: 'Oman',
    languages: [{ locale: 'en-OM', findMemberUrl: 'https://bnioman.com/en-OM/findamember' }],
  },
  {
    id: 'za',
    countryCode: 'ZA',
    label: 'South Africa',
    languages: [{ locale: 'en-ZA', findMemberUrl: 'https://bni.co.za/en-ZA/findamember' }],
  },
  {
    id: 'ng',
    countryCode: 'NG',
    label: 'Nigeria',
    languages: [{ locale: 'en-gb', findMemberUrl: 'https://bni-ng.com/en-gb/findamember' }],
  },
  {
    id: 'gh',
    countryCode: 'GH',
    label: 'Ghana',
    languages: [{ locale: 'en-GB', findMemberUrl: 'https://bnighana.com/en-GB/findamember' }],
  },
  {
    id: 'ke',
    countryCode: 'KE',
    label: 'Kenya',
    languages: [{ locale: 'en-GB', findMemberUrl: 'https://bnikenya.com/en-GB/findamember' }],
  },
  {
    id: 'ug',
    countryCode: 'UG',
    label: 'Uganda',
    languages: [{ locale: 'en-US', findMemberUrl: 'https://bniuganda.com/en-US/findamember' }],
  },

  // --- Asia Pacific ---
  {
    id: 'au',
    countryCode: 'AU',
    label: 'Australia',
    languages: [{ locale: 'en-AU', findMemberUrl: 'https://events.bni.com.au/en-AU/findamember' }],
  },
  {
    id: 'nz',
    countryCode: 'NZ',
    label: 'New Zealand',
    languages: [{ locale: 'en-NZ', findMemberUrl: 'https://bni.co.nz/en-NZ/findamember' }],
  },
  {
    id: 'in',
    countryCode: 'IN',
    label: 'India',
    languages: [{ locale: 'en-IN', findMemberUrl: 'https://bni-india.in/en-IN/findamember' }],
  },
  {
    id: 'sg',
    countryCode: 'SG',
    label: 'Singapore',
    languages: [{ locale: 'en-SG', findMemberUrl: 'https://bni.com.sg/en-SG/findamember' }],
  },
  {
    id: 'my',
    countryCode: 'MY',
    label: 'Malaysia',
    languages: [{ locale: 'en-MY', findMemberUrl: 'https://bnimalaysia.com/en-MY/findamember' }],
  },
  {
    id: 'th',
    countryCode: 'TH',
    label: 'Thailand',
    languages: [{ locale: 'en-TH', findMemberUrl: 'https://bnithailand.com/en-TH/findamember' }],
  },
  {
    id: 'hk',
    countryCode: 'HK',
    label: 'Hong Kong',
    languages: [{ locale: 'en-HK', findMemberUrl: 'https://bni.hk/en-HK/findamember' }],
  },
  {
    id: 'cn',
    countryCode: 'CN',
    label: 'China',
    languages: [{ locale: 'zh-CN', findMemberUrl: 'https://bnichina.com/zh-CN/findamember' }],
  },
  // Taiwan has no standalone finder of its own; the Hong Kong site serves a
  // dedicated zh-TW find-a-member page for Taiwanese members at a distinct
  // URL, which counts as a confirmed URL per the research doc.
  {
    id: 'tw',
    countryCode: 'TW',
    label: 'Taiwan',
    languages: [{ locale: 'zh-TW', findMemberUrl: 'https://bni.hk/zh-TW/findamember' }],
  },
  {
    id: 'kr',
    countryCode: 'KR',
    label: 'South Korea',
    languages: [{ locale: 'ko', findMemberUrl: 'https://bnikorea.com/ko/findamember' }],
  },
  {
    id: 'ph',
    countryCode: 'PH',
    label: 'Philippines',
    languages: [{ locale: 'en-PH', findMemberUrl: 'https://bni.ph/en-PH/findamember' }],
  },
  {
    id: 'vn',
    countryCode: 'VN',
    label: 'Vietnam',
    languages: [{ locale: 'vi-VN', findMemberUrl: 'https://bni.vn/vi-VN/findamember' }],
  },
  {
    id: 'lk',
    countryCode: 'LK',
    label: 'Sri Lanka',
    languages: [{ locale: 'en-SL', findMemberUrl: 'https://bni.lk/en-SL/findamember' }],
  },
  {
    id: 'kh',
    countryCode: 'KH',
    label: 'Cambodia',
    languages: [{ locale: 'en-US', findMemberUrl: 'https://bni-cambodia.com/en-US/findamember' }],
  },
];

export const BNI_SITES: BniSite[] = SITE_SEEDS.map(withBaseUrl);
