export function requireTestDatabase(): void {
  const database = new URL(process.env.DATABASE_URL ?? '').pathname;
  if (!database.endsWith('_test'))
    throw new Error(
      'Integration tests require a dedicated database whose name ends in _test. Never run them against development/production data.',
    );
}
