# @navikt/esyfo-logger

Typesikre feilhendelser oppå appens eksisterende serverlogger. Biblioteket oppretter ikke en logger, transport, trace-mekanisme eller nettleser-APM.

Bruk Node 24 LTS, TypeScript 6 og appens eksisterende Pino 10-logger. NAV-integrasjoner bruker `@navikt/pino-logger` 5.0.1 eller nyere / `@navikt/next-logger` 5.0.1 eller nyere. ESM er hovedløypen; pakken har også en CommonJS-export.

## Vanlig bruk

Definer hendelsen nær koden som eier feilen. Konteksttypen er den eneste lokale feltdefinisjonen; ingen egen schema- eller katalogfil er nødvendig.

```ts
import { logger } from "@navikt/next-logger";
import { createEventLogger, defineEvent } from "@navikt/esyfo-logger";

const log = createEventLogger(logger);

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
```

Ukjente koder, manglende felter, feilstavede felter og ekstra felter via variabler gir typefeil. Melding, nivå og operasjon bindes én gang. Deklarerte unionsvarianter beholder sammenhengen mellom feilkode og diagnostikk.

Appen velger fortsatt riktig loggpunkt og alvorlighetsnivå. Adapteren endrer ikke respons, retry, cancellation eller loggeierskap. Vanlige informasjons- og bibliotekslogger kan fortsatt bruke loggeren direkte.

## Diagnostikk

Et vurdert `Error` kan gis som tredje argument:

```ts
log.event(planHentingFeilet, {
  error_code: "UPSTREAM_HTTP_ERROR",
  upstream_status: 503,
}, reviewedCause);
```

Samme objekt videresendes som native `err`. Eksisterende logger bestemmer serialisering av melding, stack, cause og eventuelle egne feilfelter. Adapteren kopierer ikke feilobjektet og legger ikke til scrubbing. Gi bare feilobjekter som er vurdert som egnet for logging; noen HTTP-klienter legger request, headers eller responsdata på feilobjektet.

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

Metadata kontrolleres og fryses når `defineEvent` kalles. Ved logging hindres konteksten fra å overskrive blant annet hendelse, melding, nivå, native `err`/`cause` og trace-felter. Slike kollisjoner gir `TypeError` med feltnavnet, aldri feltverdien. Dette er programmeringsfeil, ikke feilsituasjoner adapteren prøver å håndtere.

Det kjøres ikke et runtime-schema for hver logg. TypeScript-kontrollene kan omgås med casts, `any` eller ved å viske ut felter fra en variabels statiske type. De er heller ikke en personverngaranti. Bruk faktisk serialisering i appens vanlige tester for kontrakt, lokal katalog, diagnostikk, riktig nivå og antall hendelser. Biblioteket kan ikke oppdage at samme feil logges på flere lag i appen.

## Lokal utvikling

```sh
pnpm test
pnpm typecheck
pnpm build
```

`typecheck` kjører også negative compiletime-eksempler. `build` lager ESM- og CommonJS-eksporter uten en ny loggingmotor eller bundler.
