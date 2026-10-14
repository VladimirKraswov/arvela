/** Same SHA-256 identity as native hub::scope; credentials never enter this value. */
export async function hubOrigin(config: { endpoint: string; certificate: string }): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([config.endpoint, config.certificate]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
