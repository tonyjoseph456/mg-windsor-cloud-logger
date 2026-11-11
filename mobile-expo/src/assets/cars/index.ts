export type WindsorColorKey =
  | 'white'
  | 'black'
  | 'green'
  | 'grey'
  | 'red'
  | 'blue'
  | 'ivory';

export interface WindsorColorOption {
  key: WindsorColorKey;
  name: string;
  hex: string;
  badge: string;
  image: any;
  fallbackUri: string;
}

export const WINDSOR_COLORS: WindsorColorOption[] = [
  {
    key: 'white',
    name: 'Pearl White',
    hex: '#F8FAFC',
    badge: '⚪',
    image: require('./windsor_white.png'),
    fallbackUri: '/cars/windsor_white.png',
  },
  {
    key: 'black',
    name: 'Starry Black',
    hex: '#0F172A',
    badge: '⚫',
    image: require('./windsor_black.png'),
    fallbackUri: '/cars/windsor_black.png',
  },
  {
    key: 'green',
    name: 'Turquoise Green',
    hex: '#2DD4BF',
    badge: '🟢',
    image: require('./windsor_green.png'),
    fallbackUri: '/cars/windsor_green.png',
  },
  {
    key: 'grey',
    name: 'Clay Rose',
    hex: '#94A3B8',
    badge: '🔘',
    image: require('./windsor_grey.png'),
    fallbackUri: '/cars/windsor_grey.png',
  },
  {
    key: 'red',
    name: 'Glaze Red',
    hex: '#EF4444',
    badge: '🔴',
    image: require('./windsor_red.png'),
    fallbackUri: '/cars/windsor_red.png',
  },
  {
    key: 'blue',
    name: 'Celestial Blue',
    hex: '#38BDF8',
    badge: '🔵',
    image: require('./windsor_blue.png'),
    fallbackUri: '/cars/windsor_blue.png',
  },
  {
    key: 'ivory',
    name: 'Champagne Gold',
    hex: '#FEF08A',
    badge: '🟡',
    image: require('./windsor_ivory.png'),
    fallbackUri: '/cars/windsor_ivory.png',
  },
];

export const WINDSOR_360_GIF = require('./windsor_360.gif');
export const WINDSOR_360_URI = '/cars/windsor_360.gif';

export function matchWindsorColor(rawColorName?: string | null): WindsorColorOption {
  if (!rawColorName) return WINDSOR_COLORS[0];
  const lower = rawColorName.toLowerCase().trim();
  if (lower.includes('black')) return WINDSOR_COLORS.find(c => c.key === 'black') || WINDSOR_COLORS[0];
  if (lower.includes('green') || lower.includes('turquoise') || lower.includes('celadon')) {
    return WINDSOR_COLORS.find(c => c.key === 'green') || WINDSOR_COLORS[0];
  }
  if (lower.includes('grey') || lower.includes('gray') || lower.includes('clay') || lower.includes('silver')) {
    return WINDSOR_COLORS.find(c => c.key === 'grey') || WINDSOR_COLORS[0];
  }
  if (lower.includes('red') || lower.includes('glaze') || lower.includes('blazing')) {
    return WINDSOR_COLORS.find(c => c.key === 'red') || WINDSOR_COLORS[0];
  }
  if (lower.includes('blue') || lower.includes('celestial') || lower.includes('deep')) {
    return WINDSOR_COLORS.find(c => c.key === 'blue') || WINDSOR_COLORS[0];
  }
  if (lower.includes('ivory') || lower.includes('gold') || lower.includes('champagne') || lower.includes('beige')) {
    return WINDSOR_COLORS.find(c => c.key === 'ivory') || WINDSOR_COLORS[0];
  }
  return WINDSOR_COLORS[0];
}
