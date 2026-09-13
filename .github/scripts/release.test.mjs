import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReleaseVersion, validatePackage } from './release-check.mjs';
import { checkUnpublished } from './release-preflight.mjs';

test('accepts explicit stable release versions', () => {
  for (const version of ['0.1.0', '1.0.0', '12.34.56']) {
    assert.equal(validateReleaseVersion(version), version);
  }
});

test('rejects unsafe, ambiguous and mutable versions', () => {
  for (const version of ['', 'latest', 'v0.1.0', '01.0.0', '1.0.0-SNAPSHOT', '../main', '1.0.0\n', '$(id)']) {
    assert.throws(() => validateReleaseVersion(version));
  }
});

const pkg = {
  name: '@navikt/esyfo-logger',
  version: '0.1.0',
  repository: { url: 'git+https://github.com/navikt/esyfo-observability.git' },
};

test('requires the exact package, version, repository and registry', () => {
  assert.doesNotThrow(() => validatePackage(pkg, pkg.name, '0.1.0'));
  for (const change of [
    { name: '@someone/logger' },
    { version: '0.2.0' },
    { private: true },
    { repository: { url: 'git+https://github.com/another/repo.git' } },
    { publishConfig: { registry: 'https://registry.npmjs.org' } },
  ]) {
    assert.throws(() => validatePackage({ ...pkg, ...change }, pkg.name, '0.1.0'));
  }
});

test('preflights all four versions, and only treats HTTP 404 as absent', async () => {
  const checked = [];
  await checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async (url) => {
    checked.push(url);
    return new Response(null, { status: 404 });
  });
  assert.equal(checked.length, 4);
  assert.ok(checked.some((url) => url.startsWith('https://npm.pkg.github.com/')));
  assert.ok(checked.some((url) => url.endsWith('/esyfo-logger-testkit-0.1.0.pom')));
  for (const status of [200, 401, 403, 429, 500]) {
    await assert.rejects(() =>
      checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async () => new Response(null, { status })),
    );
  }
});
