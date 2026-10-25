export default async function globalTeardown() {
  await globalThis.__SUMMER_TEST_PG__?.stop();
}
