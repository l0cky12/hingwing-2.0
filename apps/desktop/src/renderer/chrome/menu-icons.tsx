import { ICON } from './PopupMenu'

const PIN = 'M9 4h6l-1 6 3 3v2H7v-2l3-3z'

export const MENU_ICONS = {
  edit: <svg {...ICON}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>,
  pin: <svg {...ICON}><path d={PIN} /><path d="M12 15v6" /></svg>,
  unpin: <svg {...ICON}><path d={PIN} /><path d="M12 15v6M3 3l18 18" /></svg>,
  delete: <svg {...ICON}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  gauge: <svg {...ICON}><path d="M4 18a9 9 0 1 1 16 0" /><path d="m12 14 4-5" /></svg>,
  settings: <svg {...ICON}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>,
  help: <svg {...ICON}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></svg>,
  power: <svg {...ICON}><path d="M12 3v9" /><path d="M6.4 6.4a8 8 0 1 0 11.2 0" /></svg>
} as const
