export {};

declare global {
  /**
   * Hono route handlers sometimes treat an absent/invalid optional JSON body as
   * an empty object and then read only optional properties from the declared
   * request shape. Promise.catch normally widens those expressions to T | {},
   * which loses the useful optional-property typing even though the fallback is
   * intentionally compatible with those request shapes.
   */
  interface Promise<T> {
    catch(onrejected: (reason: unknown) => {}): Promise<T>;
  }

  /**
   * Set membership is a runtime validation operation. Accepting unknown here is
   * safe and lets request-validation code test untrusted strings against a
   * narrow canonical-value set without asserting that the value is valid first.
   */
  interface ReadonlySet<T> {
    has(value: unknown): boolean;
  }

  interface Set<T> {
    has(value: unknown): boolean;
  }
}
