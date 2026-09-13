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

test('preflights all four versions when both packages are absent', async () => {
  const checked = [];
  await checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async (url) => {
    checked.push(url);
    return new Response(null, { status: 404 });
  });
  assert.equal(checked.length, 4);
  assert.ok(checked.some((url) => url.startsWith('https://npm.pkg.github.com/')));
  assert.ok(checked.some((url) => url.endsWith('/esyfo-logger-testkit-0.1.0.pom')));
});

test('checks npm package metadata because GitHub rejects individual version routes', async () => {
  const checked = [];
  await checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async (url) => {
    checked.push(url);
    if (url.startsWith('https://maven.pkg.github.com/')) return new Response(null, { status: 404 });
    if (url.endsWith('/0.1.0')) return new Response(null, { status: 405 });
    const artifact = url.endsWith('esyfo-logger') ? 'esyfo-logger' : 'esyfo-logger-testkit';
    return Response.json({ name: `@navikt/${artifact}`, versions: { '0.0.9': { version: '0.0.9' } } });
  });
  assert.deepEqual(checked.filter((url) => url.startsWith('https://npm.pkg.github.com/')), [
    'https://npm.pkg.github.com/@navikt%2Fesyfo-logger',
    'https://npm.pkg.github.com/@navikt%2Fesyfo-logger-testkit',
  ]);
});

test('refuses an existing npm version even when its metadata is empty', async () => {
  await assert.rejects(() =>
    checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async () => Response.json({
      name: '@navikt/esyfo-logger', versions: { '0.1.0': null },
    })),
    /already exists/,
  );
});

test('refuses malformed npm metadata without printing the response body', async () => {
  const invalidMetadata = [
    null,
    {},
    { name: '@someone/other-package', versions: {} },
    { name: '@navikt/esyfo-logger' },
    { name: '@navikt/esyfo-logger', versions: null },
    { name: '@navikt/esyfo-logger', versions: [] },
    { name: '@navikt/esyfo-logger', versions: 'synthetic-private-value' },
  ];
  for (const metadata of invalidMetadata) {
    await assert.rejects(() =>
      checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async () => Response.json(metadata)),
      /returned unexpected npm metadata/,
    );
  }
  await assert.rejects(() =>
    checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async () =>
      new Response('synthetic-private-value', { status: 200 })),
    (error) => error.message.includes('invalid npm metadata') && !error.message.includes('synthetic-private-value'),
  );
});

test('refuses auth errors and unsupported responses from either registry', async () => {
  for (const registry of ['npm.pkg.github.com', 'maven.pkg.github.com']) {
    for (const status of [401, 403, 405, 429, 500]) {
      await assert.rejects(() =>
        checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async (url) =>
          new Response(null, { status: new URL(url).hostname === registry ? status : 404 })),
        new RegExp(`HTTP ${status}`),
      );
    }
  }
});

test('still refuses an existing Maven POM', async () => {
  await assert.rejects(() =>
    checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async (url) =>
      new Response(null, { status: url.startsWith('https://maven.pkg.github.com/') ? 200 : 404 })),
    /HTTP 200/,
  );
});

test('network failures stop preflight and redirects remain disabled', async () => {
  await assert.rejects(() =>
    checkUnpublished('0.1.0', 'synthetic-token', 'release-user', async (_url, options) => {
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      throw new TypeError('Network request failed');
    }),
    /Network request failed/,
  );
});
