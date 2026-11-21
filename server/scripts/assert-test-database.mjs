if (!process.env.TEST_DATABASE_URL) {
  console.error("Define TEST_DATABASE_URL para ejecutar la integración con PostgreSQL.");
  process.exit(1);
}
