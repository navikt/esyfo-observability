# @navikt/esyfo-logger-testkit

Test det appen faktisk skriver som JSON. Legg pakken i `devDependencies`; den skal ikke kjøre for hver logglinje i produksjon.

```ts
import { backendLogger } from "@navikt/next-logger";
import { createEventLogger, defineEvent } from "@navikt/esyfo-logger";
import { assertLogEvent, createLogCapture } from "@navikt/esyfo-logger-testkit";

const capture = createLogCapture();
// Bruk appens loggerfabrikk og samme innstillinger som i produksjon.
const native = backendLogger({}, capture.destination);
const log = createEventLogger(native);
const planHentingFeilet = defineEvent<{ error_code: "NETWORK_ERROR" }>({
  name: "plan_fetch_failed", level: "error", message: "Kunne ikke hente oppfølgingsplan",
});

log.event(planHentingFeilet, { error_code: "NETWORK_ERROR" }, new Error("Connection closed"));

assertLogEvent(capture.text(), {
  event: planHentingFeilet,
  context: { error_code: "NETWORK_ERROR" },
  contains: ["Connection closed"],
});
```

Dette er et minimalt bibliotekeksempel. Injiser loggeren i koden som testes, og behold appens faktiske serializere og redigering. Vent på at det asynkrone scenariet er ferdig før assertions. Capture kontrollerer JSON til den injiserte destination, ikke faktisk transport, collector eller levering til Loki.

En personverntest må legge en syntetisk sensitiv verdi inn i scenariet og bruke `excludes` for å kontrollere at den ikke logges. En sjekk av en verdi som aldri ble brukt beviser ingen redigering. Se [NAV-integrasjonstestene](../../test/nav-logger.test.ts) for både konfigurert redigering og en negativ test med sensitiv verdi i native cause. Bruk ikke bare en mock som bekrefter et `logger.error`-kall.

## Hva sjekkes?

`assertLogEvent` krever nøyaktig én logglinje. `assertLogEvents` krever alle forventede linjer i rekkefølge, med samme forventningsformat. Ingen ekstra eller umerkede feil filtreres bort.

- Gyldig JSON-objekt uten dupliserte felter, og samsvar med den pinnede v1-kontrakten.
- Forventet hendelse, nivå og menneskelesbar melding, samt operasjon når den er definert.
- Oppgitte kontekstfelter, faktisk `traceId`, nødvendig diagnostikk (`contains`) og fravær av syntetiske sensitive verdier (`excludes`).

Trace-testen skal starte en faktisk aktiv span, utføre den asynkrone koden og sende den forventede spanens trace-ID til `traceId`. Ikke lag en tilfeldig trace-ID bare for å tilfredsstille kontrakten.

For et vellykket scenario som ikke skal logge: test at `capture.text()` er tom. En tom liste til `assertLogEvents` avvises; tom utdata er ikke bevis på at loggkontrakten fungerer.

`parseLogs` kan brukes ved egne innholdsassertions og returnerer dekodede objekter. Teststøttens egne feilmeldinger viser ikke loggverdier, men egne assertionbiblioteker kan gjøre det. Bruk alltid syntetiske testdata.

Pakken er ESM og krever Node 24. Den velger ingen apphendelser eller feilkoder, renser ikke data og endrer ikke loggeren. TypeScript-typen ved `defineEvent` er appens lokale kontrakt; forventninger i testen er bevis for det konkrete scenariet, ikke en ny separat hendelseskatalog.
