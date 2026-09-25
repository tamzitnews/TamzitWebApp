// Types mirroring docs/api-contract.md. Keep in sync with the database.

export type Language = 'he' | 'en' | 'fr';
export type Audience = 'general' | 'youth';
export type Level = 'critical' | 'important' | 'general';
export type LevelFilter = Level; // 'critical' = only critical, 'important' = ≥ important, 'general' = all
export type Style = 'calm' | 'human' | 'informative' | 'light';
export type ItemKind = 'news' | 'good_news' | 'community';
export type EditionType = 'morning' | 'noon' | 'evening' | 'erev_shabbat' | 'motzash' | 'special';
export type ThemePref = 'system' | 'light' | 'dark';
export type Plan = 'free' | 'premium' | 'family';

export type FeedItem = {
  id: string;
  topic_id: string | null;
  /** Name shown on single items (search, saved, share); equals subsection ?? section. */
  topic_name: string | null;
  /** Level-1 heading of the edition the item sits under ("ביטחון", "מהמתרחש בארץ", "Security"); null when unknown. */
  section?: string | null;
  /** Level-2 heading inside the section ("החזית הדרומית", "Northern Front"); null when the section has no sub-heading here. */
  subsection?: string | null;
  level: Level;
  kind: ItemKind;
  community_id: string | null;
  community_name: string | null;
  headline: string;
  body: string;
  style: string;
  published_at: string;
  corrected_at: string | null;
  saved: boolean;
};

export type Ad = {
  id: string;
  /** Overline taken from the ad itself: "המהדורה בחסות", "תוכן שיווקי"; else a generic "פרסומת"/"Sponsored"/"Publicité". */
  label: string;
  /** Advertiser / title line when the ad has one, else null. */
  sponsor: string | null;
  /** Full ad text, WhatsApp markup removed, paragraphs separated by "\n". */
  body: string;
  /** Where the ad leads (the first link in the ad), or null. */
  link_url: string | null;
  /** Public https image: the image attached to the ad, else the link's preview image (og:image, like WhatsApp), else null. */
  image_url: string | null;
};

export type Audio = {
  id: string;
  kind: 'edition' | 'flash';
  title: string;
  audio_url: string;
  duration_sec: number | null;
  published_at: string;
};

export type Feed = {
  window: { from: string; to: string };
  edition_types: EditionType[];
  title: string | null;
  items: FeedItem[];
  special: FeedItem[];
  community: FeedItem[];
  good_news: FeedItem | null;
  ad: Ad | null;
  audio: Audio | null;
  minutes: number;
  is_premium: boolean;
};

export type ArchiveEntry = {
  id: string;
  edition_type: EditionType;
  title: string | null;
  published_at: string;
  item_count: number;
  has_audio: boolean;
  read: boolean;
  locked: boolean;
  /** Source track of the edition. */
  track?: 'classic' | 'daily' | 'teens' | 'special';
};

export type Profile = {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  birth_year: number | null;
  city: string | null;
  language: Language;
  audience: Audience;
  frequency: 1 | 2 | 3;
  slot_times: string[]; // 'HH:MM'
  level_filter: LevelFilter;
  style: Style;
  topics: string[];
  communities: string[];
  special_push: boolean;
  edition_push: boolean;
  headline_in_push: boolean;
  text_scale: number;
  theme: ThemePref;
  shabbat_city_id: string;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
};

export type Me = {
  profile: Profile;
  is_premium: boolean;
  plan: Plan;
  family_role: 'owner' | 'member' | null;
  unread_messages: number;
};

export type Topic = { id: string; name_he: string; name_en: string; name_fr: string; sort: number; is_default: boolean };
export type Community = {
  id: string;
  name_he: string;
  name_en: string | null;
  name_fr: string | null;
  description_he: string | null;
  description_en: string | null;
  description_fr: string | null;
  city_id: string | null;
  sort: number;
};
export type City = {
  id: string;
  name_he: string;
  name_en: string;
  name_fr: string;
  lat: number;
  lon: number;
  tzid: string;
  in_israel: boolean;
  candle_minutes: number;
  sort: number;
};

/** Preferences that the onboarding collects before an account exists; same keys as Profile. */
export type PrefsPatch = Partial<
  Pick<
    Profile,
    | 'full_name'
    | 'birth_year'
    | 'city'
    | 'language'
    | 'audience'
    | 'frequency'
    | 'slot_times'
    | 'level_filter'
    | 'style'
    | 'topics'
    | 'communities'
    | 'special_push'
    | 'edition_push'
    | 'headline_in_push'
    | 'text_scale'
    | 'theme'
    | 'shabbat_city_id'
    | 'onboarded'
  >
>;
