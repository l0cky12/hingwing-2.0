import { run } from '../store'
import type { Page } from './settings-view'

let wanted: Page | null = null

/** The page Settings opens on when it mounts, which is where the one that sent the user there asked. Settings takes it once. */
export const takeOpeningPage = (): Page | null => {
  const page = wanted
  wanted = null
  return page
}

/** Opens Settings on `page`. Settings that does not open leaves the next open on its own first page. */
export function openSettingsOn(page: Page): void {
  wanted = page
  void run({ do: 'editTarget' }).then(outcome => {
    if (!outcome.ok) wanted = null
  })
}
