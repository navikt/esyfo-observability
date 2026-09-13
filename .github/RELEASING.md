# Publisering

`Release packages` kjøres manuelt fra `main`. Oppgi versjonen som allerede
står i begge npm-pakkene og begge Maven-publicationene. `dry_run` er på som
standard: pakkene bygges, testes og lastes opp som et kortlivet workflow-artefakt,
men ingen pakke publiseres.

## Før første release

- Repositoryet `navikt/esyfo-observability` må finnes og teamet må ha korrekt
  tilgang. Denne workflowen oppretter ikke repoer, secrets eller rettigheter.
- Begge npm-pakker må ha repository URL
  `git+https://github.com/navikt/esyfo-observability.git`.
- GitHub Packages må tillate at repositoryets innebygde `GITHUB_TOKEN`
  publiserer. Bare publish-jobben har `packages: write`.
- Kjør først en dry-run og undersøk resultatene. Verifiser deretter den første
  publiserte versjonen fra en ren npm- og Maven-consumer med appens vanlige
  credentials. Lokal file-repository-test beviser ikke registry-tilgangen.

Publisering bruker bare GitHub Packages, ikke npmjs eller Maven Central.
Npm trusted publishing er derfor ikke brukt; ingen langlivet publish-token
skal legges inn. GitHub Packages krever autentisering også for offentlige
pakker. Consumer-repoenes tilgang må kontrolleres særskilt.

CI trenger lesetilgang til de eksisterende Nav-loggerne som testes som
dev-avhengigheter. `setup-node` med `registry-url` lager en brukerbasert
npm-konfigurasjon; pnpm utvider ikke token-plassholdere i repoets `.npmrc`.
Tokenet finnes bare i installsteget, hvor lifecycle scripts
og pnpm-hooks er avslått. Eventuell esbuild-forberedelse og alle tester kjøres
uten registry-token. Det samme gjelder release-verifiseringen.

## Hva release-gaten verifiserer

- Hendelsen er et eksplisitt manuelt valg fra `main`, og checkout peker på
  workflowens commit som ligger på main.
- Kontrakt, typesjekk, tester og faktisk pakket npm-/Maven-consumer passerer.
- Java-testene kjøres med eksplisitt launcher på Java 21 og 25.
- Release-input matcher de faktiske pakkemanifestene, ikke bare et Git-tag-navn.
- Maven-publication til et lokalt repository bevarer JAR, sources, POM og
  Gradle metadata byte for byte. Publiseringsbygget har ingen compiler eller
  kildekodeavhengighet.
- Npm sjekkes gjennom pakkens metadata-endepunkt: enten finnes ikke pakken
  (404), eller et gyldig svar (200) for riktig pakke har en `versions`-oversikt
  uten den aktuelle versjonen. Maven krever 404 for den aktuelle POM-filen.
  Eksisterende versjoner, ugyldige metadata, auth-feil, rate-limit og andre
  ukjente svar stopper publisering.

Npm publiserer de testede tarballene med lifecycle scripts avslått. Maven
publiserer de testede filene fra staging-repositoryet. Ingen pakke bygges på
nytt i publish-jobben.

## Ved delvis publisering

De fire pakkene er ikke én atomisk registry-transaksjon. Et senere upload kan
feile selv om preflight og tidligere uploads lyktes. Ikke slett pakker eller
kjør en blind retry: preflight stopper når en versjon finnes. Undersøk hvilke
artefakter som faktisk ble publisert, og avklar en eksplisitt reparasjon før
neste forsøk. Workflowen overskriver ikke eksisterende versjoner og flytter
ikke Git-tags.

## Lokale sjekker av release-oppsettet

```sh
node --test .github/scripts/release.test.mjs
actionlint .github/workflows/ci.yaml .github/workflows/release.yaml
zizmor --offline .github/workflows/ci.yaml .github/workflows/release.yaml
```

Zizmor kan gi en informasjonsmelding om npm trusted publishing. Det gjelder
npmjs/OIDC, mens dette oppsettet bevisst bruker GitHub Packages og det
kortlivede workflow-tokenet.
