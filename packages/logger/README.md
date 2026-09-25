# @navikt/esyfo-logger

Én inngang til appens serverlogging, med typesikre hendelser og enkel info-/debug-diagnostikk. Biblioteket bruker appens eksisterende logger; det oppretter ingen ny logger-motor, transport, trace-mekanisme eller nettleser-APM.

Bruk Node 24 LTS, TypeScript 6 og appens eksisterende Pino 10-logger. NAV-integrasjoner bruker `@navikt/pino-logger` 5.0.1 eller nyere / `@navikt/next-logger` 5.0.1 eller nyere. ESM er hovedløypen; pakken har også en CommonJS-export.

## Vanlig bruk

Opprett én lokal inngang, for eksempel `src/server/log.ts`, og importer den fra appkoden:

```ts
import { logger as nativeLogger } from "@navikt/next-logger";
import { createLogger } from "@navikt/esyfo-logger";

export const log = createLogger(nativeLogger);
```

Definer hendelsen nær koden som eier feilen. Konteksttypen er den eneste lokale feltdefinisjonen; ingen egen schema- eller katalogfil er nødvendig.

```ts
import { defineEvent } from "@navikt/esyfo-logger";
import { log } from "@/server/log";

const planHentingFeilet = defineEvent<{
  error_code: "UPSTREAM_HTTP_ERROR" | "INVALID_RESPONSE";
  upstream_status: number;
}>({
  name: "plan_fetch_failed",
  operation: "hent_plan",
  level: "error",
  message: "Kunne ikke hente oppfølgingsplan",
});

log.event(planHentingFeilet, {
  error_code: "UPSTREAM_HTTP_ERROR",
  upstream_status: 503,
});

log.info("Jobben starter", { attempt: 1 });
log.debug("Behandler neste side", { page: 2, cached: false });
```

Ukjente koder, manglende felter, feilstavede felter og ekstra felter via variabler gir typefeil. Melding, nivå og operasjon bindes én gang. Deklarerte unionsvarianter beholder sammenhengen mellom feilkode og diagnostikk.

Bruk `event` for appens WARN/ERROR/FATAL og navngitte domeneutfall. Vanlig status og utviklingsdiagnostikk går gjennom `info`/`debug`. Inngangen har ingen fritekstmetoder for `warn` eller `error`, og `info`/`debug` legger ikke til `event_type`.

Diagnosefeltene er et vanlig objekt med navngitte felter av typen string, endelig number, boolean eller null. `undefined` utelates før native serialisering. Objekter, arrays, funksjoner og `Error` er ikke diagnosefelt; vurdert feildiagnostikk hører til en typed hendelse. Reserverte felter som `event_type`, `error_code`, `rejection_reason`, nivå og trace avvises av typene. Ved kjøring utelates ugyldige felter og loggen merkes som beskrevet under. Primitive felter er ikke en personverngaranti: heller ikke meldinger eller strenger skal inneholde personopplysninger eller tokens.

Appen velger fortsatt riktig loggpunkt og alvorlighetsnivå. Adapteren endrer ikke respons, retry, cancellation eller loggeierskap. Native logger brukes til oppsett, redigering av sensitive felter og integrasjon med rammeverk. Logger fra tredjepartsbiblioteker og nettleserens APM fortsetter uendret; de skal ikke omskrives til apphendelser. Metrikker og tracing er separate mekanismer.

`createEventLogger(nativeLogger)` fra 0.1.0 er fortsatt tilgjengelig og bruker samme feilpolicy som `createLogger`. Den samlede inngangen legger til `info` og `debug`. Native nivåfilter beholdes; når loggeren tilbyr `isLevelEnabled`, leses ikke konteksten for et avslått nivå.

## Diagnostikk

Et vurdert `Error` kan gis som tredje argument:

```ts
log.event(planHentingFeilet, {
  error_code: "UPSTREAM_HTTP_ERROR",
  upstream_status: 503,
}, reviewedCause);
```

Samme objekt videresendes som native `err`. Eksisterende logger bestemmer serialisering av melding, stack, cause og eventuelle egne feilfelter. Adapteren kopierer ikke feilobjektet og legger ikke til scrubbing. Gi bare feilobjekter som er vurdert som egnet for logging; noen HTTP-klienter legger request, headers eller responsdata på feilobjektet.

### Kontraktfelter fra Error

`failureFields(error, { upstreamStatus })` gir `exception_type`, `cause_type`
og eventuelt `upstream_status` som et vanlig objekt. Spred feltene inn i en
typed hendelseskontekst; det er den minste formen som passer `ExactContext`
uten å legge `Error` i konteksten:

```ts
import { failureFields } from "@navikt/esyfo-logger";

const planFailed = defineEvent<{
  error_code: "UPSTREAM_HTTP_ERROR";
  exception_type: string;
  cause_type: string;
  upstream_status?: number;
}>({ name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente plan" });

log.event(planFailed, {
  error_code: "UPSTREAM_HTTP_ERROR",
  ...failureFields(reviewedCause, { upstreamStatus: responseStatus }),
}, reviewedCause);
```

`causeChain`, `exceptionType`, `causeType` og `validUpstreamStatus` kan også brukes
enkeltvis. Årsakskjeden stopper ved identitetssyklus eller 16 ledd. Ukjente
verdier får kategorien `Error`; bare heltall fra 100 til 599 tas med som status.
Node returnerer alltid `exception_type` og `cause_type`; en verdi som ikke er en
`Error`, eller `undefined`, får kategorien `Error`. På JVM utelater `failureFields`
disse feltene når årsaksleseren returnerer `null`.
Node har ikke `sql_state` eller kanselleringshjelpere: `code` som `EPIPE` er ikke
en standard SQL state. På JVM må brukere av `RuntimeLogContract` føre mulige
`exception_type`-kategorier opp i `exceptionTypes`, også fallback-kategorien.

Hjelperne produserer bare kontraktfelter og scrubber, erstatter eller kopierer
ikke `cause`. Appen eier fortsatt vurdering og håndtering av stack. Dersom
originalfeilen sendes som tredje argument, kan native logger serialisere
meldingen og stacken; ikke send den uten en personvernvurdering.

Nyttig domenediagnostikk deklareres i konteksten. Eksempelvis kan `pdl_errors` beholde den vurderte PDL-`errors[]`-diagnostikken. Dette innebærer ikke å sende PDL-data, requestvariabler eller hele klientresponsen. Appens scenariotester må bevise både nyttig forklaring og fravær av syntetiske personverncanaries i faktisk serialisert utdata.

## Felles API-avvisning

Bruk den felles hendelsen når en API-avvisning faktisk er relevant å følge opp, ikke automatisk for alle 4xx eller tekniske feil.

```ts
import { apiRequestRejected } from "@navikt/esyfo-logger";

const planTilgangAvvist = apiRequestRejected<{
  rejection_reason: "MISSING_REQUIRED_ACCESS" | "INVALID_LEADER_RELATION";
}>({
  operation: "hent_plan",
  message: "Tilgang til oppfølgingsplan ble avvist",
});

log.event(planTilgangAvvist, {
  rejection_reason: "MISSING_REQUIRED_ACCESS",
});
```

Hendelsen heter `api_request_rejected`, har WARN-nivå og bruker samme `event`-kall som lokale hendelser. Appen eier operasjonen, forklaringen og de tillatte årsakene. En ny domenehendelse krever ikke en bibliotekrelease.

## Hva kontrollene beviser

Metadata kontrolleres og fryses når `defineEvent` kalles; ugyldige statiske definisjoner gir fortsatt `TypeError`. Ved logging utelates reserverte felter, diagnoseverdier utenfor den primitive kontrakten og felter med en getter som kaster. Andre felter, hendelsens metadata og opprinnelig `cause` beholdes. Logglinjen får `logging_context_invalid=true`, som testkit avviser. Markøren er reservert for biblioteket; den inneholder verken feltverdier eller feilmeldingen fra en getter. Ingen ekstra logglinje opprettes.

Vanlige strengmeldinger videresendes uendret, også tomme strenger. Dersom JavaScript eller et cast omgår meldingstypen, brukes den faste meldingen `Invalid diagnostic message` og markøren; verdien konverteres ikke til tekst. Native logger-/encoderfeil fanges ikke. Deklarerte, nestede hendelsesfelt og vurderte feilobjekter videresendes som før, uten rekursiv validering eller scrubbing.

Det kjøres ikke et runtime-schema for hver logg. TypeScript-kontrollene kan omgås med casts, `any` eller ved å viske ut felter fra en variabels statiske type. De er heller ikke en personverngaranti. Bruk faktisk serialisering i appens vanlige tester for kontrakt, lokal katalog, diagnostikk, riktig nivå og antall hendelser. Biblioteket kan ikke oppdage at samme feil logges på flere lag i appen.

## Lokal utvikling

```sh
pnpm test
pnpm typecheck
pnpm build
```

`typecheck` kjører også negative compiletime-eksempler. `build` lager ESM- og CommonJS-eksporter uten en ny loggingmotor eller bundler.
