export type ServiceConfig = {
  databaseUrl: string;
  host: string;
  port: number;
};

export function readConfig(environment: NodeJS.ProcessEnv): ServiceConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const host = environment.HOST?.trim() || "127.0.0.1";
  const portText = environment.PORT?.trim() || "8080";
  const port = Number(portText);

  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL debe indicar una conexión PostgreSQL.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) {
    throw new Error("HOST no es válido.");
  }

  return { databaseUrl, host, port };
}
