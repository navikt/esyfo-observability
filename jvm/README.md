# JVM

Én inngang for appens logger over eksisterende SLF4J.
Kotlin 2.4.10+, Java 21+ og SLF4J 2. Bygg/test verifiseres på Java 21 og 25.
Appen beholder Logback, encoder, transport og sporingsoppsett. Ingen Ktor-plugin,
Spring-modul, retry-wrapper eller scrubber installeres.

## Én logger i appen

```kotlin
import no.nav.esyfo.observability.createLogger
import org.slf4j.LoggerFactory

// I appens loggingoppsett; resten av appen bruker log.
val nativeLogger = LoggerFactory.getLogger("PlanService")
val log = createLogger(nativeLogger)
```

Bruk `log.event(...)` for navngitte hendelser; definisjonen bestemmer nivået.
Alle appskrevne WARN/ERROR skal ha en hendelse. Enkel diagnostikk kan bruke
`log.info("Worker started")` eller `log.debug("Batch read", mapOf("count" to 3))`.
Det finnes ingen generisk `warn`/`error` på denne loggeren.

INFO/DEBUG-felter kan være String, Boolean, primitive endelige tall eller null.
Null utelates. Reserverte hendelses-, logger- og tracefelter, objekter og arrays utelates
enkeltvis og markerer loggen med `logging_context_invalid=true`;
bruk typed hendelseskontekst når det trengs strukturert diagnostikk.
Nivået sjekkes før feltlesere/feilkodeleser evalueres. Vanlige metodeargumenter
evalueres fortsatt av Kotlin før kallet.

Native SLF4J brukes i bindingen over og der et rammeverk krever den typen, ikke som
en alternativ inngang for appskrevne logger. Håndhev denne grensen i appens statiske
kodekontroll med et avgrenset unntak for bindingen; biblioteket installerer ingen lintregel.
Tredjeparts- og rammeverkslogger fortsetter uendret. Den eksisterende `Logger.emit`
er kildekompatibel for migrering/integrasjon, men nye appkall bruker `log.event`.

## En lokal hendelse

```kotlin
import no.nav.esyfo.observability.Event
import org.slf4j.event.Level

enum class PlanFailureCode { UPSTREAM_UNAVAILABLE, INVALID_RESPONSE }
data class PlanFetchFailure(val code: PlanFailureCode, val upstreamStatus: Int?)

val planFetchFailed = Event<PlanFetchFailure>(
    name = "plan_fetch_failed",
    level = Level.ERROR,
    message = "Kunne ikke hente oppfølgingsplan",
    operation = "fetch_plan",
    errorCodeFrom = { it.code.name },
    fields = mapOf("upstream_status" to { it.upstreamStatus }),
)

log.event(planFetchFailed, PlanFetchFailure(PlanFailureCode.UPSTREAM_UNAVAILABLE, 503), cause = failure)
```

Definisjonen ligger i appen. Ny hendelse krever ingen biblioteksrelease.
Feil konteksttype avvises av Kotlin-kompilatoren. Navn, nivå, melding og feltnøkler
eies av definisjonen; ekstra kontekst kan ikke overskrive standardfelter eller trace.
Ugyldige statiske navn/koder, tom melding og andre nivåer enn INFO/WARN/ERROR
avvises når definisjonen opprettes. Bruk `errorCode = "PLAN_SERVICE_UNAVAILABLE"` når
koden alltid er den samme. `errorCodeFrom` velger en kode fra typed kontekst, slik at
man ikke trenger én hendelsesdefinisjon per feilkode. De to kan ikke kombineres.
En ugyldig dynamisk kode utelates og markerer loggen med `logging_context_invalid=true`.
Null utelater `error_code` uten markering.

En feltleser som returnerer `null` utelater det toppnivåfeltet. Det passer for
`upstream_status` når ingen HTTP-respons ble mottatt. Nested diagnostikk, inkludert
nullverdier, og den originale exception med melding/årsakskjede endres ikke.
PDLs godkjente feildel kan fortsatt legges i `pdl_errors`; biblioteket fjerner den ikke.
Appen må velge egnet diagnostikk og teste personvern, ikke sende vilkårlige payloads.

Hvis en kontekst- eller feilkodeleser kaster en vanlig exception, utelates bare den
verdien. Hendelsen beholder nivå, melding, gyldige felt og opprinnelig cause; den
samme logglinjen får `logging_context_invalid=true`. Markøren er reservert og kan
ikke settes av appkontekst. Ugyldige statiske definisjoner feiler fortsatt ved opprettelse.
CancellationException, InterruptedException og JVM Error propagerer uendret.
Native logger- og encoderkall fanges ikke; dette er ingen generell garanti mot
loggfeil. Vanlige metodeargumenter evalueres fortsatt før biblioteket kalles.

Bruk `Event<Unit>` og `log.event(event, cause = failure)` når hendelsen ikke har ekstra kontekst.

## Feilfelt fra exception

`failureFields` gir kontraktgyldige `exception_type`, `cause_type`, `sql_state`
og `upstream_status` til en typed hendelse. Felter uten verdi utelates. Kategorien
finnes fra exception-klassen eller en superklasse, aldri fra feilmeldingen.
Årsakskjeden er identitetssikker og avgrenset til 16; SQL state leses kun fra
`SQLException`. `validUpstreamStatus` tar bare HTTP-status 100–599.
`isCancellation` og `rethrowIfCancelled` finner også innpakket kansellering eller
avbrudd; sistnevnte gjenoppretter trådens interrupt-flagg før avbruddet kastes.
Hele den avgrensede årsakskjeden søkes: en kansellert future innpakket i
`ExecutionException`, eller `TimeoutCancellationException`, regnes som
kansellering av gjeldende flyt og propageres uten terminal feillogg. Bruk
hjelperne ved grenser der dette er ønsket; ellers sjekk den direkte typen.
`java.sql` er en del av JDK og krever ingen ny runtime-avhengighet. Apper
med en tilpasset jlink-runtime må inkludere `java.sql`-modulen.

```kotlin
import no.nav.esyfo.observability.failureFields

data class PlanFailure(val failure: Throwable, val status: Int?, val attempt: Int)

val planFailed = Event<PlanFailure>(
    name = "plan_fetch_failed",
    level = Level.ERROR,
    message = "Kunne ikke hente plan",
    fields = failureFields<PlanFailure>({ it.failure }, { it.status }) +
        mapOf("attempt" to { context: PlanFailure -> context.attempt }),
)
log.event(planFailed, context, cause = context.failure)
```

Hjelperne produserer bare kontraktfelter; de scrubber, erstatter eller kopierer
ikke `cause`. Appen eier fortsatt vurdering av om originalfeilen og dens stack
kan logges, og må håndtere stack deretter. Ved bruk av `RuntimeLogContract` må
appen føre de mulige kategoriene opp i `exceptionTypes`, inkludert eventuelle
fallback-verdier. Test faktisk serialisert logg med syntetiske personverncanaries.

## Felles avvisningshendelse

```kotlin
import no.nav.esyfo.observability.apiRequestRejected

enum class RejectionReason { ACCESS_NOT_GRANTED }
data class AccessRejection(val reason: RejectionReason, val pdpDecision: String)

val accessRejected = apiRequestRejected<AccessRejection>(
    operation = "validate_access",
    message = "Tilgang ble ikke gitt",
    reason = { it.reason.name },
    fields = mapOf("pdp_decision" to { it.pdpDecision }),
)

log.event(accessRejected, AccessRejection(RejectionReason.ACCESS_NOT_GRANTED, "Deny"))
```

Dette gir `event_type=api_request_rejected`, WARN og påkrevd `rejection_reason`.
`errorCode` er valgfri. Operation og reason-koder er lokale. Logg først når requesten
faktisk er avvist, etter eventuell fallback. Biblioteket velger ikke HTTP-status,
tilgang eller retry og logger ikke automatisk i et ytre lag.

## Test faktisk JSON

Testkit bruker encoderen fra en allerede konfigurert Logback-appender. Den lager
ikke en ny standardencoder som kan skjule feil i appens virkelige konfigurasjon.

```kotlin
import no.nav.esyfo.observability.testkit.RuntimeLogContract
import no.nav.esyfo.observability.testkit.captureLogs

val capture = captureLogs(nativeLogger as ch.qos.logback.classic.Logger, "stdout_json")
capture.use {
    log.event(planFetchFailed, PlanFetchFailure(PlanFailureCode.UPSTREAM_UNAVAILABLE, 503), cause = failure)
}
RuntimeLogContract.forEvents(
    planFetchFailed,
    dynamicErrorCodes = PlanFailureCode.entries.map { it.name }.toSet(),
).assertValid(capture.records, expectedCount = 1)

val rejectionContract = RuntimeLogContract.forEvents(
    accessRejected,
    rejectionReasons = RejectionReason.entries.map { it.name }.toSet(),
)
```

Eventnavn, operation og statisk errorCode avledes fra de faktiske definisjonene.
Dynamiske lukkede `dynamicErrorCodes`/`rejectionReasons`/`exceptionTypes` gis separat,
gjerne fra lokale enums. En definisjon med `errorCodeFrom` krever eksplisitte
`dynamicErrorCodes`; testkit prøver ikke å utlede mulige verdier fra en funksjon.
Katalogen er felles for definisjonene som gis inn, ikke en kontroll av koblingen
mellom hver hendelse og dens mulige koder. Test slike sammenhenger eksplisitt når nødvendig.
For andre serialiserte logger finnes også `RuntimeLogContract(catalog: Map<String, Set<String>>)`.
Kontrakten gjelder navngitte hendelser, ikke enkle INFO/DEBUG-diagnostikkmeldinger.
Testkit avviser alltid tilstedeværelsen av `logging_context_invalid`, også med
verdien false eller null, slik at feil i loggkontekst feiler i CI uten å maskere
applikasjonens opprinnelige utfall i runtime. Det delte v1-schemaet er uendret.

Velg appendernavnet fra appens konfigurasjon; den må finnes på valgt logger eller
root-loggeren. Capture endrer ikke nivå, additivity, streams eller MDC og stopper
ikke den eksisterende encoderen. Den fanger loggerhendelser, ikke appenderfilterets
avgjørelse eller transportlevering. Bruk isolerte loggerkontekster for parallelle tester.

Schema og lokal katalog sjekker form og lukkede grupperingsverdier. De beviser ikke
riktig alvorlighetsgrad, personvern eller én feil per forløp. Test også fallback,
retry/terminalt utfall, kansellering, forventet antall og nødvendig diagnostikk.
Eksplisitt `expectedCount = 0` kan brukes for forventet fravær; ellers avvises tom capture.
En syntetisk MDC-test beviser ikke at NAIS-agenten sporer hele produksjonsforløpet.

## Avhengigheter og verifisering

Pakkene publiseres i GitHub Packages. De offentlige pakkene kan hentes
uten credentials gjennom [Navs pakkespeil](https://github.com/navikt/github-package-registry-mirror):

```kotlin
repositories {
    mavenCentral()
    maven("https://github-package-registry-mirror.gc.nav.no/cached/maven-release")
}

dependencies {
    implementation("no.nav.esyfo.observability:esyfo-logger:0.3.0")
    testImplementation("no.nav.esyfo.observability:esyfo-logger-testkit:0.3.0")
}
```

Appens lokale bygg og CI trenger ikke registry-credentials for denne nedlastingen.
Publisering skjer fortsatt til GitHub Packages med autentisering; speilet brukes
bare til nedlasting.

Runtime har bare Kotlin/SLF4J-avhengigheter. Testkit er en testavhengighet og bruker
networknt/Jackson internt; ingen Jackson-typer finnes i det offentlige API-et.
Logback/Logstash kommer fra appen. Testprofilen bruker Logback 1.6.3 og Logstash 9.0.

```sh
cd jvm
./gradlew check
./gradlew check -PtestJavaVersion=25
```

Java 21 brukes til bygg; testkjøring kan velge 21 eller 25. `check` inkluderer Ktor-,
worker- og coroutine-forløp, felles Node/JVM-kontraktfixtures, et separat prosjekt som
konsumerer de pakkede Maven-artefaktene, og negative compile-tester med feil konteksttype,
feil dynamisk kodetype og generisk WARN uten hendelse. 0.2.0 beholder kildekallene fra
0.1.0, men appen må bygges på nytt ved oppgradering; binærkompatibilitet er ikke garantert.

`publishAllPublicationsToStagingRepository` legger bare artefakter i
`jvm/build/staging-repository`. Dette er lokal staging, ikke ekstern publisering.
Testkit pakker originalschema fra `../contracts/runtime-error/v1.0.0` gjennom bygget;
det finnes ingen manuelt vedlikeholdt JVM-kopi.
