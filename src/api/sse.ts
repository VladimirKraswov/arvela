/** Incremental SSE framing; a bound applies to one event, not a network chunk. */
export class SseDecoder {
  private line = '';
  private data: string[] = [];
  private size = 0;
  private skipLF = false;

  constructor(private readonly maxFrameCharacters = 4_000_000) {}

  /** Returning false from consume stops processing the rest of this chunk. */
  push(text: string, consume: (data: string) => boolean): void {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (this.skipLF) {
        this.skipLF = false;
        if (char === '\n') { start = i + 1; continue; }
      }
      if (char !== '\r' && char !== '\n') continue;
      this.append(text.slice(start, i));
      const line = this.line;
      this.line = '';
      this.skipLF = char === '\r';
      start = i + 1;
      if (!line) {
        const data = this.data.join('\n');
        this.data = [];
        this.size = 0;
        if (data && !consume(data)) return;
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    this.append(text.slice(start));
  }

  private append(text: string) {
    this.size += text.length;
    if (this.size > this.maxFrameCharacters)
      throw new Error('Event stream frame exceeds the size limit');
    this.line += text;
  }
}
