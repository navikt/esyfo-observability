package no.nav.esyfo.observability.testkit

import ch.qos.logback.classic.Logger
import com.fasterxml.jackson.databind.ObjectMapper
import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.emit
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.slf4j.event.Level
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

class LogCaptureTest {
    private data class LookupFailure(val upstreamStatus: Int?, val pdlErrors: List<Map<String, Any?>>)

    @Test
    fun `no HTTP response omits optional status without removing nested PDL diagnostics`() {
        val event = Event<LookupFailure>(
            "pdl_lookup_failed", Level.ERROR, "PDL lookup failed",
            fields = mapOf("upstream_status" to { it.upstreamStatus }, "pdl_errors" to { it.pdlErrors }),
        )
        val logger = LoggerFactory.getLogger("optional-context-test") as Logger
        val capture = captureLogs(logger, "JSON")
        capture.use {
            logger.emit(
                event,
                LookupFailure(null, listOf(mapOf("message" to "Technical upstream error", "path" to null))),
                cause = IllegalStateException("Connection failed before an HTTP response"),
            )
        }
        val record = ObjectMapper().readTree(capture.records.single())
        assertFalse(record.has("upstream_status"))
        assertEquals("Technical upstream error", record.path("pdl_errors")[0].path("message").asText())
        assertTrue(record.path("pdl_errors")[0].path("path").isNull)
        assertContains(record.path("stack_trace").asText(), "Connection failed before an HTTP response")
        RuntimeLogContract.forEvents(event).assertValid(capture.records, expectedCount = 1)
    }

    @Test
    fun `tests run on the selected runtime`() {
        assertEquals(System.getProperty("expectedJavaVersion"), Runtime.version().feature().toString())
    }

    @Test
    fun `captures configured encoder immediately with native diagnostics and leaves logging unchanged`() {
        val logger = LoggerFactory.getLogger("capture-test") as Logger
        val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
        val appender = root.getAppender("JSON")
        val originalLevel = logger.level
        val originalAdditive = logger.isAdditive
        val traceId = "1234567890abcdef1234567890abcdef"
        val event = Event<Unit>("capture_failed", Level.ERROR, "An actionable diagnosis", operation = "capture")
        val capture = captureLogs(logger, "JSON")
        capture.use {
            MDC.put("trace_id", traceId)
            try {
                logger.emit(event, Unit, IllegalStateException("Native exception message"))
            } finally {
                MDC.remove("trace_id")
            }
        }
        val json = capture.records.single()
        assertContains(json, "\"application\":\"configured-capture-test\"")
        assertContains(json, "\"trace_id\":\"$traceId\"")
        assertContains(json, "Native exception message")
        assertContains(json, "An actionable diagnosis")
        assertEquals(originalLevel, logger.level)
        assertEquals(originalAdditive, logger.isAdditive)
        assertSame(appender, root.getAppender("JSON"))
        assertFalse(logger.iteratorForAppenders().asSequence().any())
    }
}
