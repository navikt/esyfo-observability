import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateReleaseVersion } from './release-check.mjs';

export async function checkUnpublished(version, token, actor, request = fetch) {
  validateReleaseVersion(version);
  assert.ok(token, 'GITHUB_TOKEN is required for registry checks');
  assert.ok(actor, 'GITHUB_ACTOR is required for Maven authentication');
  for (const artifact of ['esyfo-logger', 'esyfo-logger-testkit']) {
    const checks = [
      {
        url: `https://npm.pkg.github.com/@navikt%2F${artifact}/${version}`,
        authorization: `Bearer ${token}`,
      },
      {
        url: `https://maven.pkg.github.com/navikt/esyfo-observability/no/nav/esyfo/observability/${artifact}/${version}/${artifact}-${version}.pom`,
        authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString('base64')}`,
      },
    ];
    for (const { url, authorization } of checks) {
      const response = await request(url, {
        headers: { authorization },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      assert.equal(
        response.status,
        404,
        `Refusing to publish: ${url} returned HTTP ${response.status}; expected an absent version (404)`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkUnpublished(
    process.env.RELEASE_VERSION,
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_ACTOR,
  );
  console.log('All four registry version checks returned 404; no existing versions will be overwritten.');
}
