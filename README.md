# eSyfo observability

En felles logginngang og teststøtte for Team eSyfo. Appen beholder sin eksisterende logger og definerer hendelsene der de hører hjemme. Biblioteket gir typesikre hendelser og enkel info/debug, uten å overta transport, tracing eller feilhåndtering.

| Pakke | Bruk |
| --- | --- |
| [`@navikt/esyfo-logger`](packages/logger/README.md) | Typer og hendelser oppå eksisterende Node-/Next-logger |
| [`@navikt/esyfo-logger-testkit`](packages/logger-testkit/README.md) | Test av faktisk serialiserte Node-logger |
| [`no.nav.esyfo.observability:esyfo-logger`](jvm/README.md) | Kotlin-hendelser oppå eksisterende SLF4J-logger |
| [`no.nav.esyfo.observability:esyfo-logger-testkit`](jvm/README.md) | Test av appens konfigurerte JVM-encoder |

## Hva er felles, og hva eier appen?

Biblioteket eier feltnavn, metadata og den lille adapteren til loggeren. Appen eier domenespråk, konkrete hendelser, feilkoder, kontekst og hvor det skal logges. En ny domenehendelse krever ingen bibliotekrelease.

Den felles hendelsen `api_request_rejected` brukes til en faktisk API-avvisning som er relevant å følge opp. Appen velger operasjon, forklaring og tillatte årsaker. Ikke bruk den for alle 4xx, og ikke logg en avvisning dersom en fallback faktisk gir tilgang. Velg én dekkende hendelse per utfall eller forsøk; ikke logg både en generell og en domenespesifikk feil for samme utfall.

Dette repoet samler bibliotekene, den pinnede loggkontrakten og felles testeksempler. Dashboards, tjenesteoversikt og driftsveiledning blir i [team-esyfo](https://github.com/navikt/team-esyfo). Vi flytter ikke alt observability-arbeid hit.

## Kort eksempel

Koble til den eksisterende loggeren én gang i en lokal servermodul:

```ts
import { logger } from "@navikt/next-logger";
import { createLogger } from "@navikt/esyfo-logger";

export const log = createLogger(logger);
```

Resten av appen importerer denne inngangen. Hendelsen ligger nær koden som eier den:

```ts
import { defineEvent } from "@navikt/esyfo-logger";
import { log } from "./logger.js";

const planHentingFeilet = defineEvent<{
  error_code: "NETWORK_ERROR" | "INVALID_RESPONSE";
}>({
  name: "plan_fetch_failed",
  level: "error",
  message: "Kunne ikke hente oppfølgingsplan",
});

log.event(planHentingFeilet, { error_code: "NETWORK_ERROR" });
log.info("Oppryddingen er ferdig", { removed_count: 12 });
```

Kotlin bruker samme loggfelter, men vanlige dataklasser og SLF4J: se [JVM-eksemplene](jvm/README.md). Teststøtten er en utviklings-/testavhengighet, ikke en del av appens runtime.

## Hvilken inngang skal jeg bruke?

| Du skal logge | Bruk |
| --- | --- |
| En advarsel eller feil i migrert serverkode | `log.event(...)` med lokal, typed definisjon. Definisjonen velger nivå og forklaring. |
| Vanlig informasjon eller debug | `log.info(...)` / `log.debug(...)`, med valgfri enkel diagnostikk. |
| En navngitt INFO-hendelse som skal kunne grupperes | `log.event(...)` med INFO i definisjonen. |
| Framework-/avhengighetslogger eller loggerens oppstart | Eksisterende native oppsett. Biblioteket overtar ikke disse. |
| Nettleserfeil | Appens nettleserintegrasjon/APM/Faro, ikke serverbiblioteket. |
| Antall, varighet eller tracing | Eksisterende metrikker og OpenTelemetry/APM, ikke logghendelser som erstatning. |

Den felles inngangen har ingen fri `warn` eller `error`. Dermed slipper kallstedet å velge mellom to måter å logge samme feil. Det betyr ikke at alle forventede avvisninger skal få en logg: appen velger fortsatt hva som trenger diagnostikk og hvilket lag som eier loggen.

Typer sikrer bruken av inngangen, ikke at den blir brukt. Appens CI skal derfor sperre direkte native logger-importer og `console`/`println` i migrert serverkode. Tillat bare navngitte oppstarts-/integrasjonsmoduler og tester. Bruk eksisterende lintregler der de finnes, ellers en avgrenset arkitekturtest; test at et ugyldig kall faktisk stoppes. Dette er en vedlikeholdsregel, ikke en sikkerhetsgrense mot bevisst omgåelse.

Innfør regelen per modul og dokumenter hva som ennå ikke er migrert. Frameworklogger og eldre, uklassifiserte feil skal fortsatt være synlige i dashboardene. Ikke skru av eksisterende logger for å få et grønt kontraktresultat.

## Moderne standardoppsett

- Node 24 LTS, TypeScript 6 og Pino 10. NAV-integrasjonene testes med `@navikt/pino-logger` og `@navikt/next-logger` 5.0.1. Oppgrader eldre loggeroppsett ved innføring; biblioteket inneholder ingen kompatibilitetsadapter for dem.
- Kotlin 2.4.10, SLF4J 2 og Java 21-bytecode, testet på Java 21 og 25. Ktor er prioritert. JVM-adapteren kan brukes med SLF4J i eksisterende Spring-apper, men vi har ingen egen Spring-modul eller støttematrise for eldre Spring-oppsett.
- Appen og NAIS-oppsettet eier JSON-encoder, stdout, OpenTelemetry og aktiv trace-kontekst. Adapteren lager ikke nye trace-ID-er. JVM-encoderen må ta med SLF4J key-value-felter og MDC; dette skal verifiseres med appens faktiske konfigurasjon.
- Nettleserfeil fortsetter gjennom NAIS APM/Faro. Node-pakken er for serverkode, ikke nettleserlogging.

Vi følger [NAIS sin loggingveiledning](https://docs.nais.io/observability/logging/) og de native API-ene til Pino og [SLF4J](https://www.slf4j.org/manual.html). Det innføres ingen ny transport, logger-motor, scrubber eller sporingsmekanisme. Metrikker er fortsatt førstevalg for overvåking og varsling; disse hendelsene skal gjøre feilsøking enklere.

## Diagnostikk og personvern

Nyttige feilforklaringer skal beholdes. Vurderte native feil kan sendes som separat `cause`, og videresendes til eksisterende logger med samme objektidentitet. Noen klientfeil inneholder request, headers eller responsdata; det er ikke trygt å sende ethvert feilobjekt ukritisk.

PDL sin `errors[]`-diagnostikk skal ikke fjernes som generell «scrubbing». Logg den vurderte feildiagnostikken, ikke PDL-data, requestvariabler eller hele klientresponsen.

Typer hjelper mot feil bruk, men beviser ikke personvern. Test en faktisk feilsituasjon gjennom appens virkelige logger: behold relevant diagnose og trace, kontroller riktig nivå og antall hendelser, og legg syntetiske sensitive verdier i inngangen for å bevise at de ikke kommer i loggen. Ikke bruk produksjonslogger eller personopplysninger som testdata.

## Kontrakt og versjoner

[runtime-error v1.0.0](contracts/runtime-error/v1.0.0/schema.json) er en byte-identisk kopi av den allerede publiserte kontrakten i team-esyfo. Opprinnelig `$id` og URL beholdes. `source.json` peker på kildecommit, og sjekksummer kontrolleres i bygg og pakket teststøtte. Endre ikke en utgitt kontrakt på stedet; en endret kontrakt får ny versjon. Bibliotekversjon og kontraktversjon er separate.

Kontrakten beskriver formen på loggen, ikke alle appens mulige hendelser eller hva det er riktig å logge. Typekontroll og appens scenariotester dekker det lokale innholdet. De samme gyldige og ugyldige JSON-eksemplene kjøres gjennom begge språkstakkene.

## Innføring i en app

1. Oppdater til det moderne loggeroppsettet og behold eksisterende konfigurasjon for trace og redigering av sensitive felter.
2. Legg runtimepakken til appen og teststøtten kun til testene. Bruk eksisterende loggerinstans.
3. Eksporter én lokal logginngang med `createLogger`. Flytt et avgrenset områdes advarsler og feil til lokale, typed definisjoner, og håndhev inngangen i CI. Behold den funksjonelle oppførselen og diagnostikken.
4. Test med appens encoder, reell asynkron trace-kontekst og syntetiske data. Test også en vellykket fallback eller cancellation der det er relevant.
5. Innfør resten gradvis. Ikke endre domenefeil eller logg alle forventede utfall bare for å fylle dashboardet.

**0.2.0** tilfører den felles logginngangen og kontekstavhengige JVM-feilkoder. `createEventLogger` og `Logger.emit` fra 0.1.0 er fortsatt tilgjengelige for gradvis innføring. JVM-konsumenter må kompileres på nytt ved oppgradering. Runtime-error-kontrakt v1.0.0 er uendret.

Versjon 0.1.0 er publisert. Bruk eksemplene under etter at 0.2.0 er publisert fra `main`; en bibliotek-PR alene gjør ikke pakken tilgjengelig. Pinn pakkeversjonen, og verifiser pakketilgang i appens CI før merge.

For Node/Next med eksisterende GitHub Packages-oppsett:

```sh
pnpm add --save-exact @navikt/esyfo-logger@0.2.0
pnpm add --save-dev --save-exact @navikt/esyfo-logger-testkit@0.2.0
```

Node-pakkene bruker appens vanlige GitHub Packages-autentisering. JVM-pakkene kan lastes ned uten credentials gjennom Navs pakkespeil: se [avhengigheter og registryoppsett](jvm/README.md#avhengigheter-og-verifisering). Biblioteket trenger ingen produksjonssecrets. Se [releaseveiledningen](.github/RELEASING.md) for publisering.

## Utvikling og verifisering

```sh
pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
pnpm rebuild esbuild --ignore-pnpmfile
pnpm run check
cd jvm
./gradlew check -PtestJavaVersion=21
./gradlew check -PtestJavaVersion=25
```

Installering av NAV-testavhengighetene krever vanlig GitHub Packages-lesetilgang. Lokalt brukes eksisterende brukerbasert pnpm-/npm-autentisering. Ved bruk av `NODE_AUTH_TOKEN` må plassholderen stå i brukerens `.npmrc`, ikke repoets:

```ini
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Bruk tokenet bare for installeringen, ikke under kjøring av tester eller andre scripts. CI lar `actions/setup-node` opprette denne brukerbaserte konfigurasjonen. [pnpm ignorerer token-plassholdere i prosjektets `.npmrc`](https://pnpm.io/npmrc#environment-variables-in-auth-settings); ikke omgå denne beskyttelsen. Ingen credentials skal sjekkes inn.

`pnpm run check` bygger og installerer de faktiske npm-arkivene i en separat konsument, med både ESM-, CommonJS- og typekontroll. JVM-testene bruker også publiseringsklare filer fra et lokalt Maven-repository. Releaseflyten publiserer disse verifiserte filene, uten å bygge dem på nytt. Ekte registrytilgang og appintegrasjon må i tillegg verifiseres ved første publisering og innføring.
