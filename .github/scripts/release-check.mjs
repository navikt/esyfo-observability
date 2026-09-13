import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'git+https://github.com/navikt/esyfo-observability.git';
const registry = 'https://npm.pkg.github.com';
const artifacts = ['esyfo-logger', 'esyfo-logger-testkit'];

export function validateReleaseVersion(version) {
  assert.match(version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  assert.equal(version.trim(), version);
  return version;
}

export function validatePackage(pkg, name, version) {
  assert.equal(pkg.name, name, 'Unexpected package name');
  assert.equal(pkg.version, version, `${name}: version mismatch`);
  assert.notEqual(pkg.private, true, `${name}: package is private`);
  assert.equal(pkg.repository?.url, repository, `${name}: repository mismatch`);
  assert.equal(pkg.publishConfig?.registry ?? registry, registry, `${name}: registry mismatch`);
}

function checkArtifacts(version) {
  for (const artifact of artifacts) {
    const tarball = `artifacts/npm/navikt-${artifact}-${version}.tgz`;
    const packed = JSON.parse(
      execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
    );
    validatePackage(packed, `@navikt/${artifact}`, version);

    const base = `artifacts/maven/no/nav/esyfo/observability/${artifact}/${version}/${artifact}-${version}`;
    const module = JSON.parse(readFileSync(`${base}.module`, 'utf8'));
    assert.equal(module.component.group, 'no.nav.esyfo.observability');
    assert.equal(module.component.module, artifact);
    assert.equal(module.component.version, version);
    for (const extension of ['jar', 'pom', 'module']) {
      assert.ok(readFileSync(`${base}.${extension}`).length > 0, `Empty ${artifact}.${extension}`);
    }
    assert.ok(readFileSync(`${base}-sources.jar`).length > 0, `Empty ${artifact} sources`);
  }
  console.log(`Verified npm and Maven release artifacts for ${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkArtifacts(validateReleaseVersion(process.env.RELEASE_VERSION));
}
