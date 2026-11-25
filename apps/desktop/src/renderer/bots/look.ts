import { canonicalBotId } from '@highwing/hermes/domain'
import { blobUrlOf } from './pictures'

export const FACE_SHAPES = ['circle', 'squircle', 'flower', 'cloud', 'sparkle', 'seal', 'blob', 'drop', 'pill', 'diamond', 'hexagon', 'triangle'] as const
export type FaceShape = typeof FACE_SHAPES[number]

export const FACE_COLORS = {
  ink: '#1F2A26', slate: '#4F7396', teal: '#1E8A76', moss: '#5B8A4E', olive: '#8A9440', amber: '#D49A2A',
  coral: '#D96A4E', brick: '#B04A34', rose: '#C26A86', plum: '#7A68A8', umber: '#8C6A4C', graphite: '#7C8783'
} as const
export type FaceColor = keyof typeof FACE_COLORS
export const FACE_COLOR_NAMES = Object.keys(FACE_COLORS) as readonly FaceColor[]

export type Face = { readonly from: 'face'; readonly shape: FaceShape | 'auto'; readonly color: FaceColor }

/** What the New bot dialog will save as the bot's picture. Every `picture` is a data URL. */
export type Look =
  | Face
  /** As main checked it. */
  | { readonly from: 'upload'; readonly picture: string }
  | { readonly from: 'generate'; readonly picture: string }
  | { readonly from: 'pet'; readonly slug: string; readonly name: string; readonly picture: string }

/** Every new bot gets a face unless the user picks otherwise. */
export const DEFAULT_LOOK: Face = { from: 'face', shape: 'auto', color: 'slate' }

export const titleOf = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

/** The shape `auto` stands for: picked from the name Hermes keeps, so a name always gets the same shape. */
export function shapeFor(shape: FaceShape | 'auto', name: string): FaceShape {
  if (shape !== 'auto') return shape
  const hash = [...canonicalBotId(name)].reduce((held, char) => (held * 31 + char.charCodeAt(0)) >>> 0, 7)
  return FACE_SHAPES[hash % FACE_SHAPES.length] as FaceShape
}

/** Surprise me: a shape and a color other than the ones the face shows, so it always changes. `random` answers in [0, 1). */
export function surpriseFor(face: Face, name: string, random: () => number = Math.random): Face {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T
  const shown = shapeFor(face.shape, name)
  return { from: 'face', shape: pick(FACE_SHAPES.filter(shape => shape !== shown)), color: pick(FACE_COLOR_NAMES.filter(color => color !== face.color)) }
}

/** What is picked, in words: the face's color and shape, or where the picture came from. */
export function lookWords(look: Look, name: string): string {
  switch (look.from) {
    case 'face': return `${titleOf(look.color)} ${shapeFor(look.shape, name)}, picked ${look.shape === 'auto' ? 'from the name' : 'by you'}`
    case 'upload': return 'Uploaded picture'
    case 'generate': return 'Generated picture'
    case 'pet': return `${look.name}, a pet`
  }
}

const at = (value: number) => value.toFixed(2)

/** A closed path around the centre of the 100-unit box, `radius` units out at each angle from the top. */
function polar(radius: (angle: number) => number, steps = 180): string {
  const points = Array.from({ length: steps + 1 }, (_, step) => {
    const angle = (step / steps) * Math.PI * 2
    const out = radius(angle)
    return `${step === 0 ? 'M' : 'L'}${at(50 + out * Math.cos(angle - Math.PI / 2))} ${at(50 + out * Math.sin(angle - Math.PI / 2))}`
  })
  return `${points.join('')}Z`
}

function polygon(sides: number, radius: number, turn = 0): string {
  return Array.from({ length: sides }, (_, side) => {
    const angle = turn + (side / sides) * Math.PI * 2
    return `${at(50 + radius * Math.sin(angle))},${at(50 - radius * Math.cos(angle))}`
  }).join(' ')
}

const SQUIRCLE = polar(angle => 40 / (Math.abs(Math.cos(angle)) ** 4 + Math.abs(Math.sin(angle)) ** 4) ** 0.25)
const SPARKLE = polar(angle => 26 + 20 * Math.abs(Math.cos(2 * angle)) ** 3)
const SEAL = polar(angle => 38 + 4 * Math.cos(10 * angle))
const BLOB = polar(angle => 37 + 4 * Math.sin(3 * angle + 1) + 3 * Math.cos(5 * angle))
const PETALS = Array.from({ length: 6 }, (_, petal) => `<circle cx="${at(50 + 22 * Math.sin((petal * Math.PI) / 3))}" cy="${at(50 - 22 * Math.cos((petal * Math.PI) / 3))}" r="17"/>`).join('')
const rounded = (points: string, fill: string, width: number, more = '') =>
  `<polygon points="${points}" fill="${fill}" stroke="${fill}" stroke-width="${width}" stroke-linejoin="round"${more}/>`

/** Each shape's body, and how far its eyes move from the centre, if at all. */
const SHAPES: { readonly [S in FaceShape]: { readonly body: (fill: string) => string; readonly eyes?: readonly [number, number] } } = {
  circle: { body: fill => `<circle cx="50" cy="50" r="40" fill="${fill}"/>` },
  squircle: { body: fill => `<path fill="${fill}" d="${SQUIRCLE}"/>` },
  flower: { body: fill => `<g fill="${fill}"><circle cx="50" cy="50" r="24"/>${PETALS}</g>` },
  cloud: { body: fill => `<g fill="${fill}"><circle cx="34" cy="56" r="22"/><circle cx="56" cy="40" r="25"/><circle cx="70" cy="60" r="20"/><rect x="30" y="52" width="44" height="28" rx="14"/></g>`, eyes: [0, 4] },
  sparkle: { body: fill => `<path fill="${fill}" d="${SPARKLE}"/>` },
  seal: { body: fill => `<path fill="${fill}" d="${SEAL}"/>` },
  blob: { body: fill => `<path fill="${fill}" d="${BLOB}"/>` },
  drop: { body: fill => `<path fill="${fill}" d="M50 8C50 8 84 42 84 62A34 34 0 0 1 16 62C16 42 50 8 50 8Z"/>`, eyes: [0, 10] },
  pill: { body: fill => `<rect x="8" y="26" width="84" height="48" rx="24" fill="${fill}"/>` },
  diamond: { body: fill => rounded(polygon(4, 36), fill, 14) },
  hexagon: { body: fill => rounded(polygon(6, 36, Math.PI / 6), fill, 12) },
  triangle: { body: fill => rounded(polygon(3, 38), fill, 16, ' transform="translate(0 6)"'), eyes: [0, 12] }
}

const EYES = '<rect x="38" y="40" width="7.5" height="17" rx="3.75" transform="rotate(8 41 48)"/><rect x="54.5" y="40" width="7.5" height="17" rx="3.75" transform="rotate(8 58 48)"/>'

/** A face as SVG markup, for the picker, the preview and the stored picture alike. Its eyes are dark, and light on ink. */
export function faceSvg(shape: FaceShape, color: FaceColor, size: number): string {
  const { body, eyes: [dx, dy] = [0, 0] } = SHAPES[shape]
  const eye = color === 'ink' ? '#F6F7F3' : FACE_COLORS.ink
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${body(FACE_COLORS[color])}`
    + `<g fill="${eye}" transform="translate(${dx} ${dy})">${EYES}</g></svg>`
}

const SIDE = 512

async function drawn(url: string | null, draw: (context: CanvasRenderingContext2D, image: HTMLImageElement) => void): Promise<string> {
  if (url === null) throw new Error('not a picture Highwing can draw')
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = SIDE
    canvas.height = SIDE
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d canvas')
    draw(context, image)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The PNG data URL Hermes stores for a look: a picture is drawn onto a 512 px square, and an upload is sent as main checked it. */
export async function pictureOf(look: Look, name: string): Promise<string> {
  switch (look.from) {
    case 'upload':
      return look.picture
    case 'face': {
      const svg = new Blob([faceSvg(shapeFor(look.shape, name), look.color, SIDE)], { type: 'image/svg+xml' })
      return drawn(URL.createObjectURL(svg), (context, image) => context.drawImage(image, 0, 0, SIDE, SIDE))
    }
    case 'pet':
      return drawn(blobUrlOf(look.picture), (context, image) => {
        // Pixel art scaled by a whole number with no smoothing keeps every pixel square and sharp.
        const scale = Math.max(1, Math.floor(SIDE / Math.max(image.naturalWidth, image.naturalHeight)))
        const [width, height] = [image.naturalWidth * scale, image.naturalHeight * scale]
        context.imageSmoothingEnabled = false
        context.drawImage(image, Math.floor((SIDE - width) / 2), Math.floor((SIDE - height) / 2), width, height)
      })
    case 'generate':
      return drawn(blobUrlOf(look.picture), (context, image) => {
        const scale = SIDE / Math.min(image.naturalWidth, image.naturalHeight)
        const [width, height] = [image.naturalWidth * scale, image.naturalHeight * scale]
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, (SIDE - width) / 2, (SIDE - height) / 2, width, height)
      })
  }
}
