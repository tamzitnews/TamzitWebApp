import type * as React from 'react';

export type Level = 'critical' | 'important' | 'general';
export type Period = 'morning' | 'noon' | 'evening' | 'motzash';
export type IconName = 'bell' | 'bookmark' | 'bookmark-check' | 'calendar' | 'check' | 'chevron-left' | 'chevron-right' | 'circle-check' | 'clock' | 'feather' | 'flag' | 'flame' | 'globe' | 'headphones' | 'heart' | 'heart-handshake' | 'history' | 'info' | 'list' | 'lock' | 'map-pin' | 'message-circle' | 'message-circle-question' | 'moon' | 'newspaper' | 'pause' | 'play' | 'plus' | 'rotate-ccw' | 'search' | 'settings' | 'share-2' | 'sliders-horizontal' | 'smile' | 'sprout' | 'star' | 'sun' | 'sunrise' | 'thumbs-down' | 'thumbs-up' | 'type' | 'users' | 'x';

/** The Tamzit logo from the site's files. Horizontal falls back to the mark in the dark theme. */
export interface LogoProps { variant?: 'horizontal' | 'mark' | 'vertical' | 'parent'; height?: number; alt?: string; className?: string }
export declare function Logo(props: LogoProps): React.ReactElement;
/** The app icon: the mark on a surface-raised plate. */
export declare function AppIcon(props: { size?: number }): React.ReactElement;
/** The site's two diagonal squares, bound to sky and surface-tint. */
export declare function SquaresMotif(props: { size?: number; flip?: boolean; className?: string; style?: React.CSSProperties }): React.ReactElement;
/** A Lucide stroke icon in currentColor. */
export interface IconProps { name: IconName; size?: number; strokeWidth?: number; fill?: boolean; label?: string; flip?: boolean; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

/** The pill button. One primary per screen. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'quiet' | 'whatsapp' | 'sun' | 'hero'; size?: 'md' | 'lg'; block?: boolean; icon?: IconName; iconFill?: boolean; iconEnd?: IconName; href?: string }
export declare function Button(props: ButtonProps): React.ReactElement;
/** A 44px round icon button; label is required. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { icon: IconName; label: string; variant?: 'tint' | 'hero'; pressed?: boolean; size?: number; fill?: boolean }
export declare function IconButton(props: IconButtonProps): React.ReactElement;

/** A multi-select toggle chip (aria-pressed). */
export interface ChipProps { children?: React.ReactNode; selected?: boolean; defaultSelected?: boolean; onChange?: (selected: boolean) => void; icon?: IconName; className?: string; style?: React.CSSProperties }
export declare function Chip(props: ChipProps): React.ReactElement;
/** One of 2–4 short options, as a real radio group. */
export interface SegmentedProps { legend?: string; name?: string; options: { value: string; label: string; hint?: string }[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; className?: string }
export declare function Segmented(props: SegmentedProps): React.ReactElement;
/** A radio card with title, description and a sample shown when selected. */
export interface OptionCardProps { name: string; value: string; title: string; description?: string; sample?: string; icon?: IconName; media?: React.ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement>; type?: 'radio' | 'checkbox'; lang?: string; dir?: 'rtl' | 'ltr'; className?: string }
export declare function OptionCard(props: OptionCardProps): React.ReactElement;
/** An on/off setting that applies at once (role=switch). */
export interface SwitchProps { label: string; description?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; className?: string }
export declare function Switch(props: SwitchProps): React.ReactElement;

/** Three squares; the filled count is the level. The word shows for critical. */
export declare function LevelMeter(props: { level: Level; showLabel?: boolean; className?: string }): React.ReactElement;
/** Day and date, edition name, item count, reading time and Listen. */
export interface EditionHeaderProps { period?: Period; date?: string; title?: string; items?: number; minutes?: number; audio?: boolean; onListen?: () => void; className?: string }
export declare function EditionHeader(props: EditionHeaderProps): React.ReactElement;
/** One news item with save, share and feedback. */
export interface NewsItemProps { topic: string; time?: string | null; level?: Level; headline: string; body?: React.ReactNode; children?: React.ReactNode; saved?: boolean; defaultSaved?: boolean; onSaveChange?: (saved: boolean) => void; onShare?: () => void; onFeedback?: () => void; actions?: boolean; showLevelLabel?: boolean; className?: string }
export declare function NewsItem(props: NewsItemProps): React.ReactElement;
/** The audio edition bar on surface-hero. Times are seconds. */
export interface AudioPlayerProps { title?: string; duration?: number; position?: number; playing?: boolean; onToggle?: (playing: boolean) => void; speed?: number; onSpeed?: (speed: number) => void; className?: string; style?: React.CSSProperties }
export declare function AudioPlayer(props: AudioPlayerProps): React.ReactElement;
/** "ונסיים בטוב": the good-news card that ends every edition. */
export declare function GoodNews(props: { title: string; body?: React.ReactNode; children?: React.ReactNode; className?: string }): React.ReactElement;
/** "זהו, אתם מעודכנים": the end of an edition and the next one's time. */
export declare function EndOfEdition(props: { title?: string; text?: string; nextName?: string; nextTime?: string; className?: string }): React.ReactElement;
/** The single labelled ad slot of a free edition. */
export declare function AdSlot(props: { sponsor?: string; children?: React.ReactNode; onRemoveAds?: () => void; className?: string }): React.ReactElement;
/** The 4:5 share image, always light. */
export declare function ShareCard(props: { topic?: string; headline?: string; body?: string; date?: string; className?: string }): React.ReactElement;
/** Bottom sheet: helpful/not, report an error or ask the editors. */
export declare function FeedbackSheet(props: { onClose?: () => void; className?: string; style?: React.CSSProperties }): React.ReactElement;

/** An archive row; locked marks a premium-only edition. */
export declare function EditionRow(props: { period?: Period; title?: string; meta?: string; unread?: boolean; locked?: boolean; onClick?: () => void; className?: string }): React.ReactElement;
/** Archive search; locked for free users. */
export declare function SearchField(props: { id?: string; label?: string; placeholder?: string; locked?: boolean; defaultValue?: string; className?: string }): React.ReactElement;

/** A plan on the premium screen. */
export interface PlanCardProps { name: string; price: string; features?: string[]; highlighted?: boolean; ribbon?: string; cta?: string; current?: boolean; className?: string }
export declare function PlanCard(props: PlanCardProps): React.ReactElement;
/** One-time or monthly donation to the nonprofit. */
export declare function DonationCard(props: { amounts?: number[]; defaultAmount?: number; frequency?: 'once' | 'monthly'; title?: string; text?: string; className?: string }): React.ReactElement;
/** The "תומך/ת" badge for premium and family members. */
export declare function SupporterBadge(props: { label?: string; className?: string }): React.ReactElement;
/** A city or community whose local news can join the edition. */
export declare function CommunityCard(props: { name: string; description?: string; joined?: boolean; defaultJoined?: boolean; onChange?: (joined: boolean) => void; className?: string }): React.ReactElement;

/** Top bar: mark or back, title, subtitle, actions. */
export interface AppBarProps { title?: string; subtitle?: string; back?: boolean; onBack?: () => void; logo?: boolean; actions?: IconButtonProps[]; children?: React.ReactNode; className?: string }
export declare function AppBar(props: AppBarProps): React.ReactElement;
/** The four fixed tabs. */
export declare function TabBar(props: { active?: 'edition' | 'archive' | 'saved' | 'settings'; onChange?: (tab: string) => void; className?: string }): React.ReactElement;
/** A settings row. chevron={false} for an info-only row. */
export declare function ListRow(props: { icon?: IconName; title: string; value?: string; badge?: React.ReactNode; chevron?: boolean; onClick?: () => void; className?: string }): React.ReactElement;
/** A labelled group of ListRows on surface-raised. */
export declare function ListGroup(props: { label?: string; children?: React.ReactNode; className?: string }): React.ReactElement;

/** A 360×760 phone outline for screen mockups. */
export declare function PhoneFrame(props: { caption?: string; theme?: 'light' | 'dark'; dir?: 'rtl' | 'ltr'; lang?: string; children?: React.ReactNode }): React.ReactElement;
export declare function WelcomeScreen(props: { onStart?: () => void }): React.ReactElement;
export declare function OnboardingScreen(props: { step?: 'language' | 'topics' | 'rhythm' | 'style' }): React.ReactElement;
export declare function EditionScreen(props: { view?: 'top' | 'end'; sheet?: boolean; premium?: boolean; period?: Period; date?: string; playing?: boolean; items?: NewsItemProps[] }): React.ReactElement;
export declare function ArchiveScreen(props: { tab?: 'archive' | 'saved'; premium?: boolean }): React.ReactElement;
export declare function SettingsScreen(props: { section?: 'main' | 'communities' }): React.ReactElement;
export declare function PremiumScreen(props: { view?: 'plans' | 'donate' }): React.ReactElement;
export declare function ShabbatScreen(props: { greeting?: string; text?: string; city?: string; time?: string }): React.ReactElement;

declare global {
  interface Window {
    Tamzit: {
      Logo: typeof Logo; AppIcon: typeof AppIcon; SquaresMotif: typeof SquaresMotif; Icon: typeof Icon;
      Button: typeof Button; IconButton: typeof IconButton;
      Chip: typeof Chip; Segmented: typeof Segmented; OptionCard: typeof OptionCard; Switch: typeof Switch;
      LevelMeter: typeof LevelMeter; EditionHeader: typeof EditionHeader; NewsItem: typeof NewsItem; AudioPlayer: typeof AudioPlayer;
      GoodNews: typeof GoodNews; EndOfEdition: typeof EndOfEdition; AdSlot: typeof AdSlot; ShareCard: typeof ShareCard; FeedbackSheet: typeof FeedbackSheet;
      EditionRow: typeof EditionRow; SearchField: typeof SearchField;
      PlanCard: typeof PlanCard; DonationCard: typeof DonationCard; SupporterBadge: typeof SupporterBadge; CommunityCard: typeof CommunityCard;
      AppBar: typeof AppBar; TabBar: typeof TabBar; ListRow: typeof ListRow; ListGroup: typeof ListGroup;
      PhoneFrame: typeof PhoneFrame; WelcomeScreen: typeof WelcomeScreen; OnboardingScreen: typeof OnboardingScreen; EditionScreen: typeof EditionScreen;
      ArchiveScreen: typeof ArchiveScreen; SettingsScreen: typeof SettingsScreen; PremiumScreen: typeof PremiumScreen; ShabbatScreen: typeof ShabbatScreen;
      ICON_NAMES: IconName[];
    };
  }
}
