/** Announce an outage once per scope/episode. Do not resurrect a dismissed toast
 * on every prompt, and clear only our own message after confirmed recovery. */
export class McpNotices {
  private reports = new Map<string, { ids: string; text: string }>();

  update(key: string, issues: { id: string; name: string }[], visible: string | null): string | null | undefined {
    const previous = this.reports.get(key);
    const ids = issues.map(s => s.id).sort().join('\0');
    if (!ids) {
      this.reports.delete(key);
      return previous?.text === visible ? null : undefined;
    }
    if (previous?.ids === ids) return undefined;
    const text = `Недоступны MCP: ${issues.map(s => s.name).join(', ')}. Отправка доступна; проверьте подключение в настройках.`;
    this.reports.set(key, { ids, text });
    if (this.reports.size > 80) this.reports.delete(this.reports.keys().next().value!);
    return text;
  }
}
