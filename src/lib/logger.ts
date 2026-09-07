type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: 'info' | 'warn' | 'error', message: string, fields: LogFields = {}): void {
  const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...cleanFields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};

export function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    error: error.name,
    message: error.message,
    code: (error as { code?: string }).code,
  };
}
