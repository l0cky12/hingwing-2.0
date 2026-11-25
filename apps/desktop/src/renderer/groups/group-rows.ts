/** "Ada", "Ada and Sam", "Ada, Sam and Juno". */
export const namesInWords = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
