export type HubFailureCode = 'lease_expired' | 'timeout' | 'network' | 'tls' | 'interrupted' | 'http' | 'transport';
const codes: HubFailureCode[] = ['lease_expired','timeout','network','tls','interrupted','http','transport'];
export class HubRequestError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: HubFailureCode, readonly status?: number) {
    const message = code === 'lease_expired' ? 'Срок заявки на модель истёк. Требуется новая заявка Hub.'
      : code === 'timeout' ? 'Hub не ответил вовремя.'
      : code === 'network' ? 'Не удалось установить соединение с Hub. Проверьте сеть, доступность сервера и разрешение Enki на доступ к локальной сети.'
      : code === 'tls' ? 'Не удалось проверить TLS-сертификат Hub. Проверьте адрес, сертификат и дату на компьютере.'
      : code === 'interrupted' ? 'Соединение с Hub оборвалось при получении ответа.'
      : code === 'http' ? status === 401 ? 'Hub отклонил ключ устройства. Проверьте ключ в настройках Hub.'
        : status === 403 ? 'Hub запретил эту операцию. Проверьте права устройства.'
        : status === 409 ? 'Срок заявки на модель истёк или заявка конфликтует с текущим состоянием Hub.'
        : status === 429 ? 'Hub ограничил частоту запросов. Дождитесь повторного подключения.'
        : status && status >= 500 ? `Временная ошибка сервера Hub (HTTP ${status}).`
        : `Hub отклонил запрос (HTTP ${status ?? '—'}).`
      : 'Не удалось выполнить запрос к Hub. Проверьте настройки подключения.';
    super(message); this.name = 'HubRequestError';
    this.retryable = ['timeout','network','interrupted'].includes(code) || code === 'http' && !!status && (status === 408 || status === 429 || [500,502,503,504].includes(status));
  }
}
/** Only the bounded native error envelope is machine-readable; never guess TLS
 * failures from arbitrary strings, and never expose URLs, tokens or raw bodies. */
export function decodeHubError(value: unknown): unknown {
  if (value instanceof HubRequestError) return value;
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('ENKI_HUB_ERROR:')) return value;
  try {
    const parsed = JSON.parse(value.slice('ENKI_HUB_ERROR:'.length));
    if (!codes.includes(parsed.code) || parsed.status != null && (!Number.isInteger(parsed.status) || parsed.status < 100 || parsed.status > 599)) return value;
    return new HubRequestError(parsed.code, parsed.status ?? undefined);
  } catch { return value; }
}
