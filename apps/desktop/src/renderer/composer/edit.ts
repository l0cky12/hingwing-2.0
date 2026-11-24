/** A sent message put back in the composer to be sent again. `later` counts the turns after it, which the send removes. */
export interface Editing {
  readonly rowId: number
  readonly later: number
  readonly text: string
}

export const removalWords = (later: number) => `This removes ${later} later ${later === 1 ? 'message' : 'messages'}.`
