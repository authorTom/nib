/**
 * The palettes on offer.
 *
 * A palette and a mode are separate axes: `data-palette` picks the colour
 * family, `data-theme` picks light or dark within it. Every palette defines
 * both, so the theme toggle keeps working whichever one is chosen. The actual
 * colour values live in styles/themes.css — this file is the catalogue the
 * picker and the command palette read.
 */

export interface ThemeInfo {
  id: string
  name: string
  /** One line, shown under the name in the picker. */
  description: string
  /**
   * Three colours for the card's preview, in the order bg / surface / accent.
   * Both modes are listed so the swatch shows what you'd actually get — a
   * light preview while the app is dark would be a preview of the wrong thing.
   */
  swatch: [string, string, string]
  swatchDark: [string, string, string]
  /** Hidden until found. See EASTER_EGG_KEYWORDS. */
  secret?: boolean
}

export const DEFAULT_THEME = 'deckle'

export const THEMES: ThemeInfo[] = [
  {
    id: 'deckle',
    name: 'Deckle',
    description: 'Indigo on paper. The original.',
    swatch: ['#ffffff', '#f7f7f8', '#4f46e5'],
    swatchDark: ['#18181b', '#1f1f23', '#818cf8'],
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Cool greys with a clear blue.',
    swatch: ['#ffffff', '#f8fafc', '#2563eb'],
    swatchDark: ['#0f172a', '#16213a', '#60a5fa'],
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic blues, low glare.',
    swatch: ['#eceff4', '#e5e9f0', '#5e81ac'],
    swatchDark: ['#2e3440', '#343b48', '#88c0d0'],
  },
  {
    id: 'rose',
    name: 'Rosé',
    description: 'Warm mauve, easy after dark.',
    swatch: ['#faf4ed', '#fffaf3', '#b4637a'],
    swatchDark: ['#191724', '#1f1d2e', '#ebbcba'],
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep greens and quiet contrast.',
    swatch: ['#fbfdfb', '#f1f6f1', '#2f7d52'],
    swatchDark: ['#0e1712', '#131e18', '#5fd39a'],
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Greyscale. Nothing competes with the text.',
    swatch: ['#ffffff', '#f6f6f6', '#111111'],
    swatchDark: ['#0b0b0b', '#141414', '#f2f2f2'],
  },
  {
    id: 'springfield',
    name: 'Springfield',
    description: 'Mmm… donuts.',
    swatch: ['#fffdf2', '#ffe98a', '#1a6aa2'],
    swatchDark: ['#1b1710', '#241f15', '#ffd90f'],
    secret: true,
  },
]

export function themeById(id: string): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/**
 * Type any of these into the command palette to turn up the hidden theme.
 *
 * Matched as ordinary command keywords, so the entry simply appears mid-search
 * — no key sequence to memorise, and nothing to see until someone goes looking.
 */
export const EASTER_EGG_KEYWORDS =
  'simpsons springfield donut doughnut homer bart lisa marge duff doh cowabunga woohoo excellent skinner flanders'
