/** A client-generated id for replay keys and request ids. UUID where the platform has one. */
export function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (c?.randomUUID) return c.randomUUID()
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`
}
