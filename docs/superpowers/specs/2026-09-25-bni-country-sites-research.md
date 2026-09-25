# BNI country "find a member" sites — research

Companion data to
[2026-09-25-bni-global-rewrite-design.md](2026-09-25-bni-global-rewrite-design.md)
§3.2/3.4. This is the raw input for seeding `registry/sites.ts` during
implementation — one `BniSite` entry per verified national URL below (the
technical `website_id`/`countryIds` are *not* recorded here on purpose; they
get discovered live per §3.2, not hardcoded).

Researched 2026-09-25. Status: ~45 of ~150 BNI-active countries have a
verified national "find a member" page. Larger markets without one (USA,
Brazil, Indonesia, Spain) are split into regional sites instead — those need
separate, ongoing enumeration (§3.4 of the design doc) and are out of scope
for the initial seed list.

## Deutschsprachig

| Land | URL |
|---|---|
| Deutschland & Österreich | https://bni.de/de-DE/findamember |
| Schweiz (DE) | https://bni.swiss/de-CH/findamember |
| Schweiz (FR) | https://bni.swiss/fr-CH/findamember |

## Europa

| Land | URL / Hinweis |
|---|---|
| Vereinigtes Königreich | https://bni.co.uk/en-GB/findamember |
| Irland | https://bni.ie/en-IE/findamember |
| Frankreich | https://bnifrance.fr/fr/trouverunmembre |
| Belgien (Flämisch) | https://bni-vlaanderen.be/nl/zoekeenlid |
| Belgien (Französisch) | https://bnibelgique.be/fr/trouverunmembre |
| Niederlande | https://bni-nederland.nl/nl/zoekeenlid |
| Luxemburg | https://bniluxembourg.lu/fr/trouverunmembre |
| Spanien | Nur regionale Seiten (bniespana.com, bniespanacnm.com, bniespanaslc.com) – kein nationaler Mitglieder-Finder |
| Portugal | https://bni-portugal.com/pt/findamember |
| Italien | https://bni-italia.com/en-GB/findamember |
| Griechenland | https://bni.bni-greece.com/el/findamember |
| Schweden | https://bni.nu/sv/vemarmed |
| Dänemark | https://bni.as/da/findforretningspartner |
| Norwegen | https://bni.no/nb/finnenforretningspartner |
| Finnland | https://bni.fi/fi/etsiliikekumppani |
| Polen | https://bnipolska.pl/znajdz-osobe/ |
| Tschechien | https://bni-czechia.com/cs/findamember |
| Slowakei | http://bni.sk/sk-SK/findamember *(nur HTTP; HTTPS hat SSL-Zertifikatsfehler)* |
| Ungarn | https://bni-hungary.com/hu-HU/findamember |
| Rumänien | https://bni-romania.com/ro-RO/gasesteunmembru |
| Kroatien | https://bni-croatia.com/hr-HR/findamember |
| Slowenien | https://bni-slovenia.com/sl/findamember |
| Serbien | http://bni-serbia.com/sr-Latn-RS/findamember |
| Bulgarien | https://bni.bg/bg/findamember |
| Lettland | https://bni.lv/lv/findamember |
| Litauen | https://bni.lt/en/findamember |
| Estland | https://bni.ee/et/leialiige |
| Türkei | https://bni.com.tr/tr/findamember |
| Albanien, Nordmazedonien, Bosnien-Herzegowina, Zypern, Malta, Island | Kein nationaler BNI-Auftritt mit Mitglieder-Finder gefunden |

## Nordamerika

| Land | URL / Hinweis |
|---|---|
| USA | Nur regionale Seiten (z.B. bniwis.com, bnineo.com, socalbni.com) – kein nationaler Mitglieder-Finder |
| Kanada (EN) | https://bnicanada.ca/en-CA/findamember |
| Kanada (FR) | https://bnicanada.ca/fr-CA/findamember |

## Lateinamerika

| Land | URL / Hinweis |
|---|---|
| Mexiko | https://bnimexico.com/es-MX/encuentraunmiembro |
| Kolumbien | https://bnicolombia.com/es-CO/encuentra-un-miembro |
| Peru | https://bniperu.com/es-PE/encontrarunmiembro |
| Chile | http://bnichile.com/es-CL/findamember |
| Costa Rica | https://bnicostarica.com/es-CR/encontrarmiembro |
| Guatemala | http://bniguatemala.com/es-MX/findamember |
| Brasilien | Nur regionale Seiten – kein nationaler Mitglieder-Finder (bnibrasil.net.br nicht erreichbar) |
| Argentinien, Ecuador, Venezuela, Bolivien, Paraguay, Uruguay, Honduras, Nicaragua, El Salvador, Panama, Dominikanische Republik, Puerto Rico, Trinidad & Tobago, Jamaika | Kein nationaler BNI-Auftritt mit Mitglieder-Finder gefunden |

## Middle East & Africa

| Land | URL / Hinweis |
|---|---|
| Israel | https://bni.co.il/iw/findamember |
| VAE | https://bni.ae/en-AE/findamember |
| Oman | https://bnioman.com/en-OM/findamember |
| Südafrika | https://bni.co.za/en-ZA/findamember |
| Nigeria | https://bni-ng.com/en-gb/findamember |
| Ghana | https://bnighana.com/en-GB/findamember |
| Kenia | https://bnikenya.com/en-GB/findamember |
| Uganda | https://bniuganda.com/en-US/findamember |
| Saudi-Arabien, Kuwait, Bahrain, Katar, Jordanien, Libanon, Ägypten, Marokko, Kamerun, Elfenbeinküste, Tansania, Simbabwe, Sambia, Botswana, Namibia, Ruanda, Äthiopien | Kein nationaler BNI-Auftritt mit Mitglieder-Finder gefunden |

## Asia Pacific

| Land | URL / Hinweis |
|---|---|
| Australien | https://events.bni.com.au/en-AU/findamember |
| Neuseeland | https://bni.co.nz/en-NZ/findamember |
| Indien | https://bni-india.in/en-IN/findamember |
| Singapur | https://bni.com.sg/en-SG/findamember |
| Malaysia | https://bnimalaysia.com/en-MY/findamember |
| Thailand | https://bnithailand.com/en-TH/findamember |
| Hongkong | https://bni.hk/en-HK/findamember |
| China (Festland) | https://bnichina.com/zh-CN/findamember |
| Taiwan | Kein eigenständiger Finder — Hongkong-Seite bietet zh-TW unter bni.hk/zh-TW/findamember |
| Japan | https://bni.jp/ja/findamember |
| Südkorea | https://bnikorea.com/ko/findamember |
| Philippinen | https://bni.ph/en-PH/findamember |
| Vietnam | https://bni.vn/vi-VN/findamember |
| Sri Lanka | https://bni.lk/en-SL/findamember |
| Kambodscha | https://bni-cambodia.com/en-US/findamember |
| Indonesien | Nur regionale Seiten – kein nationaler Mitglieder-Finder (bniindonesia.com /findamember gibt 404) |
| Bangladesch, Pakistan, Myanmar | Kein nationaler BNI-Auftritt mit Mitglieder-Finder gefunden |

## Bereits technisch verifizierte Beispiel-Regionalseiten (USA)

Nur Beispiele, keine vollständige Liste — zur Bestätigung, dass regionale
US-Seiten auf derselben Plattform laufen und genauso onboardable sind:

| Site | findMemberUrl |
|---|---|
| Wisconsin | https://bniwis.com/en-US/findamember |
| New Orleans | https://bnineo.com/en-US/findamember |
| Southern California | https://socalbni.com/en-US/findamember |
