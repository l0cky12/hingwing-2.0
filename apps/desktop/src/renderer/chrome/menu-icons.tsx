import { ICON } from './PopupMenu'

const PIN = 'M9 4h6l-1 6 3 3v2H7v-2l3-3z'

export const MENU_ICONS = {
  edit: <svg {...ICON}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>,
  pin: <svg {...ICON}><path d={PIN} /><path d="M12 15v6" /></svg>,
  unpin: <svg {...ICON}><path d={PIN} /><path d="M12 15v6M3 3l18 18" /></svg>,
  delete: <svg {...ICON}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
} as const
