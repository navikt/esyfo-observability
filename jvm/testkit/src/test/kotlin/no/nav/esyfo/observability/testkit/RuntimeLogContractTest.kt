package no.nav.esyfo.observability.testkit

import ch.qos.logback.classic.Logger
import com.fasterxml.jackson.databind.ObjectMapper
import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.apiRequestRejected
import no.nav.esyfo.observability.createLogger
import no.nav.esyfo.observability.emit
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.event.Level
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class RuntimeLogContractTest {
    private val lookupContract = RuntimeLogContract(mapOf("event_type" to setOf("lookup_failed")))
    private enum class FailureCode { UPSTREAM_UNAVAILABLE, INVALID_RESPONSE }

    @Test
    fun `dynamic event codes require an explicit closed catalog and validate actual serialized values`() {
        val event = Event<FailureCode>("plan_fetch_failed", Level.ERROR, "Could not fetch plan", errorCodeFrom = { it.name })
        val staticEvent = Event<Unit>("other_failed", Level.ERROR, "Other operation failed", errorCode = "OTHER_FAILURE")
        assertFailsWith<IllegalArgumentException> { RuntimeLogContract.forEvents(event) }
        val native = LoggerFactory.getLogger("dynamic-contract-test") as Logger
        val log = createLogger(native)
        val capture = captureLogs(native, "JSON").also {
            it.use {
                FailureCode.entries.forEach { code -> log.event(event, code) }
                log.event(staticEvent)
            }
        }
        RuntimeLogContract.forEvents(event, staticEvent, dynamicErrorCodes = FailureCode.entries.map { it.name }.toSet())
            .assertValid(capture.records, expectedCount = 3)
        val restricted = RuntimeLogContract.forEvents(event, staticEvent, dynamicErrorCodes = setOf("UPSTREAM_UNAVAILABLE"))
        assertEquals(listOf(LogViolation(2, "error_code is not in the application's closed catalog")), restricted.validate(capture.records))
    }

    @Test
    fun `Node and JVM share exactly the same JSON shape fixtures`() {
        val fixtures = requireNotNull(javaClass.getResourceAsStream("/contracts/runtime-error/fixtures/v1.json"))
            .use { ObjectMapper().readTree(it) }
        val contract = RuntimeLogContract(
            mapOf(
                "event_type" to setOf("plan_fetch_failed", "api_request_rejected", "pdl_lookup_failed", "plan_not_found"),
                "error_code" to setOf("NETWORK_ERROR"),
                "operation" to setOf("fetch_plan"),
                "rejection_reason" to setOf("ACCESS_DENIED"),
            ),
        )
        assertEquals(15, fixtures.size())
        fixtures.forEach { fixture ->
            assertEquals(
                fixture.path("valid").asBoolean(),
                contract.validate(listOf(fixture.path("json").asText())).isEmpty(),
                fixture.path("name").asText(),
            )
        }
    }

    @Test
    fun `invalid JSON missing identity unknown constants and duplicate fields cannot pass`() {
        listOf(
            "not JSON",
            "",
            "null",
            "{}",
            "{\"event_type\":\"unknown_event\"}",
            "{\"event_type\":\"lookup_failed\",\"operation\":\"not_in_catalog\"}",
            "{\"event_type\":\"lookup_failed\",\"event_type\":\"lookup_failed\"}",
            "{\"event_type\":\"lookup_failed\",\"trace_id\":\"00000000000000000000000000000000\"}",
            "{\"event_type\":\"lookup_failed\"} {}",
        ).forEach { record ->
            assertNotEquals(emptyList(), lookupContract.validate(listOf(record)))
        }
    }

    @Test
    fun `empty capture must be intentional and expected count prevents hidden duplicate logs`() {
        assertTrue(lookupContract.validate(emptyList()).isNotEmpty())
        assertEquals(emptyList(), lookupContract.validate(emptyList(), expectedCount = 0))
        assertFailsWith<AssertionError> {
            lookupContract.assertValid(List(2) { "{\"event_type\":\"lookup_failed\"}" }, expectedCount = 1)
        }
    }

    @Test
    fun `catalog only accepts supported non-empty closed values`() {
        listOf(
            emptyMap(),
            mapOf("event_type" to emptySet()),
            mapOf("event_type" to setOf("Not an event")),
            mapOf("event_type" to setOf("lookup_failed"), "pdp_decision" to setOf("Deny")),
        ).forEach { catalog -> assertFailsWith<IllegalArgumentException> { RuntimeLogContract(catalog) } }
    }
    @Test
    fun `validates actual configured JSON against bundled schema and application catalog`() {
        val logger = LoggerFactory.getLogger("contract-test") as Logger
        val event = apiRequestRejected<Unit>("validate_access", "Access was not granted", reason = { "ACCESS_NOT_GRANTED" })
        val capture = captureLogs(logger, "JSON").also {
            it.use { logger.emit(event, Unit) }
        }
        val contract = RuntimeLogContract.forEvents(event, rejectionReasons = setOf("ACCESS_NOT_GRANTED"))
        assertEquals(emptyList(), contract.validate(capture.records, expectedCount = 1))
        contract.assertValid(capture.records, expectedCount = 1)
    }
}
