# JVM

Små, typesikre hendelsesdefinisjoner over appens eksisterende SLF4J-logger.
Kotlin 2.4.10+, Java 21+ og SLF4J 2. Bygg/test verifiseres på Java 21 og 25.
Appen beholder Logback, encoder, transport og sporingsoppsett. Ingen Ktor-plugin,
Spring-modul, retry-wrapper eller scrubber installeres.

## En lokal hendelse

```kotlin
import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.emit
import org.slf4j.LoggerFactory
import org.slf4j.event.Level

data class PlanFetchFailure(val upstreamStatus: Int?)

val planFetchFailed = Event<PlanFetchFailure>(
    name = "plan_fetch_failed",
    level = Level.ERROR,
    message = "Kunne ikke hente oppfølgingsplan",
    operation = "fetch_plan",
    errorCode = "PLAN_SERVICE_UNAVAILABLE",
    fields = mapOf("upstream_status" to { it.upstreamStatus }),
)

val log = LoggerFactory.getLogger("PlanService")
log.emit(planFetchFailed, PlanFetchFailure(503), cause = failure)
```

Definisjonen ligger i appen. Ny hendelse krever ingen biblioteksrelease.
Feil konteksttype avvises av Kotlin-kompilatoren. Navn, nivå, melding og feltnøkler
eies av definisjonen; ekstra kontekst kan ikke overskrive standardfelter eller trace.
Ugyldige statiske navn/koder, tom melding og andre nivåer enn INFO/WARN/ERROR
avvises når definisjonen opprettes. Vanlige DEBUG/TRACE-logger kan fortsatt gå direkte til SLF4J.

En feltleser som returnerer `null` utelater det toppnivåfeltet. Det passer for
`upstream_status` når ingen HTTP-respons ble mottatt. Nested diagnostikk, inkludert
nullverdier, og den originale exception med melding/årsakskjede endres ikke.
PDLs godkjente feildel kan fortsatt legges i `pdl_errors`; biblioteket fjerner den ikke.
Appen må velge egnet diagnostikk og teste personvern, ikke sende vilkårlige payloads.

Bruk `Event<Unit>` og `log.emit(event, cause = failure)` når hendelsen ikke har ekstra kontekst.

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

log.emit(accessRejected, AccessRejection(RejectionReason.ACCESS_NOT_GRANTED, "Deny"))
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

val capture = captureLogs(log as ch.qos.logback.classic.Logger, "stdout_json")
capture.use {
    log.emit(planFetchFailed, PlanFetchFailure(503), cause = failure)
}
RuntimeLogContract.forEvents(planFetchFailed)
    .assertValid(capture.records, expectedCount = 1)

val rejectionContract = RuntimeLogContract.forEvents(
    accessRejected,
    rejectionReasons = RejectionReason.entries.map { it.name }.toSet(),
)
```

Eventnavn, operation og errorCode avledes fra de faktiske definisjonene. Bare
dynamiske lukkede `rejectionReasons`/`exceptionTypes` gis separat, gjerne fra lokale enums.
For andre serialiserte logger finnes også `RuntimeLogContract(catalog: Map<String, Set<String>>)`.

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

Versjon 0.1.0 er publisert i GitHub Packages. De offentlige pakkene kan hentes
uten credentials gjennom [Navs pakkespeil](https://github.com/navikt/github-package-registry-mirror):

```kotlin
repositories {
    mavenCentral()
    maven("https://github-package-registry-mirror.gc.nav.no/cached/maven-release")
}

dependencies {
    implementation("no.nav.esyfo.observability:esyfo-logger:0.1.0")
    testImplementation("no.nav.esyfo.observability:esyfo-logger-testkit:0.1.0")
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
konsumerer de pakkede Maven-artefaktene, og en negativ compile-test med feil konteksttype.

`publishAllPublicationsToStagingRepository` legger bare artefakter i
`jvm/build/staging-repository`. Dette er lokal staging, ikke ekstern publisering.
Testkit pakker originalschema fra `../contracts/runtime-error/v1.0.0` gjennom bygget;
det finnes ingen manuelt vedlikeholdt JVM-kopi.
