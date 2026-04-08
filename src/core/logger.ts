export class Logger {
  constructor(private subsystem: string) {}

  info(msg: string, data?: Record<string, unknown>): void {
    const prefix = `[${this.subsystem}]`;
    if (data) {
      console.log(`${prefix} ${msg}`, data);
    } else {
      console.log(`${prefix} ${msg}`);
    }
  }

  error(msg: string, data?: Record<string, unknown>): void {
    const prefix = `[${this.subsystem}]`;
    if (data) {
      console.error(`${prefix} ${msg}`, data);
    } else {
      console.error(`${prefix} ${msg}`);
    }
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    const prefix = `[${this.subsystem}]`;
    if (data) {
      console.warn(`${prefix} ${msg}`, data);
    } else {
      console.warn(`${prefix} ${msg}`);
    }
  }
}
