package no.nav.esyfo.observability

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxy
import ch.qos.logback.core.AppenderBase
import ch.qos.logback.core.OutputStreamAppender
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.slf4j.event.Level
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertSame

class ApplicationLoggerTest {
    private enum class FailureCode { UPSTREAM_UNAVAILABLE, INVALID_RESPONSE }

    @Test
    fun `disabled levels do not evaluate event fields dynamic codes or diagnostic fields`() {
        val event = Event<Unit>(
            "maintenance_completed", Level.INFO, "Maintenance completed",
            fields = mapOf("count" to { error("Disabled context was read") }),
            errorCodeFrom = { error("Disabled code was read") },
        )
        val fields = object : AbstractMap<String, Any?>() {
            override val entries: Set<Map.Entry<String, Any?>> get() = error("Disabled diagnostic fields were read")
        }
        capture { native, records ->
            native.level = ch.qos.logback.classic.Level.ERROR
            val log = createLogger(native)
            log.event(event)
            log.info("Disabled info", fields)
            log.debug("Disabled debug", fields)
            assertEquals(0, records.size)
        }
    }

    @Test
    fun `invalid dynamic codes cannot emit and static and dynamic codes are mutually exclusive`() {
        assertFailsWith<IllegalArgumentException> {
            Event<Unit>("plan_fetch_failed", Level.ERROR, "Could not fetch plan", errorCode = "STATIC_CODE", errorCodeFrom = { "DYNAMIC_CODE" })
        }
        val event = Event<String>("plan_fetch_failed", Level.ERROR, "Could not fetch plan", errorCodeFrom = { it })
        capture { native, records ->
            val log = createLogger(native)
            for (code in listOf("", "not-a-code", "P".repeat(81))) {
                val failure = assertFailsWith<IllegalArgumentException> { log.event(event, code) }
                assertFalse(code.isNotEmpty() && code in failure.message.orEmpty())
            }
            assertEquals(0, records.size)
        }
    }

    @Test
    fun `one event preserves different typed error codes in actual JSON`() {
        val event = Event<FailureCode?>(
            "plan_fetch_failed", Level.ERROR, "Could not fetch plan",
            errorCodeFrom = { it?.name },
        )
        capture { native, records ->
            val log = createLogger(native)
            FailureCode.entries.forEach { log.event(event, it) }
            log.event(event, null)
            assertEquals(3, records.size)
            assertContains(records[0].json, "\"error_code\":\"UPSTREAM_UNAVAILABLE\"")
            assertContains(records[1].json, "\"error_code\":\"INVALID_RESPONSE\"")
            assertFalse("error_code" in records[2].json)
            records.forEach { assertContains(it.json, "\"event_type\":\"plan_fetch_failed\"") }
        }
    }

    @Test
    fun `diagnostics reject reserved fields objects and nonfinite numbers before emitting`() {
        capture { native, records ->
            val log = createLogger(native)
            for (field in listOf("event_type", "error_code", "operation", "rejection_reason", "level", "message", "trace_id", "stack_trace")) {
                assertFailsWith<IllegalArgumentException>(field) { log.info("Diagnostic", mapOf(field to "override")) }
                assertFailsWith<IllegalArgumentException>(field) { log.debug("Diagnostic", mapOf(field to null)) }
            }
            for (value in listOf(IllegalStateException("private cause"), mapOf("nested" to "payload"), listOf(1), Double.NaN, Float.POSITIVE_INFINITY)) {
                assertFailsWith<IllegalArgumentException> { log.info("Diagnostic", mapOf("detail" to value)) }
            }
            assertFailsWith<IllegalArgumentException> { log.info(" ") }
            assertEquals(0, records.size)
        }
    }

    @Test
    fun `plain info and debug use native levels and primitive metadata without event identity`() {
        capture { native, records ->
            val log = createLogger(native)
            log.info("Worker started", mapOf("count" to 2, "enabled" to true, "queue" to "plans", "absent" to null))
            log.debug("Batch read", mapOf("count" to 3))
            assertEquals(2, records.size)
            assertContains(records[0].json, "\"level\":\"INFO\"")
            assertContains(records[0].json, "\"message\":\"Worker started\"")
            assertContains(records[0].json, "\"count\":2")
            assertContains(records[0].json, "\"enabled\":true")
            assertContains(records[0].json, "\"queue\":\"plans\"")
            assertContains(records[1].json, "\"level\":\"DEBUG\"")
            records.forEach { record ->
                assertFalse("event_type" in record.json)
                assertFalse("absent" in record.json)
            }
        }
    }

    @Test
    fun `application event uses existing encoder and retains original cause and trace`() {
        val event = Event<Int>(
            "plan_fetch_failed", Level.ERROR, "Could not fetch plan",
            errorCode = "PLAN_SERVICE_UNAVAILABLE",
            fields = mapOf("upstream_status" to { it }),
        )
        val failure = IllegalStateException("Useful diagnostic", IllegalArgumentException("Original cause"))
        capture { native, records ->
            val log = createLogger(native)
            MDC.put("trace_id", "0123456789abcdef0123456789abcdef")
            try {
                log.event(event, 503, cause = failure)
                assertEquals("0123456789abcdef0123456789abcdef", MDC.get("trace_id"))
            } finally {
                MDC.remove("trace_id")
            }
            val record = records.single()
            assertContains(record.json, "\"event_type\":\"plan_fetch_failed\"")
            assertContains(record.json, "\"level\":\"ERROR\"")
            assertContains(record.json, "\"upstream_status\":503")
            assertContains(record.json, "\"application\":\"configured-test\"")
            assertContains(record.json, "\"trace_id\":\"0123456789abcdef0123456789abcdef\"")
            assertContains(record.json, "Useful diagnostic")
            assertContains(record.json, "Original cause")
            assertSame(failure, record.cause)
        }
    }

    private data class Record(val json: String, val cause: Throwable?)

    private fun capture(test: (Logger, List<Record>) -> Unit) {
        val logger = LoggerFactory.getLogger("application-logger-test") as Logger
        val originalLevel = logger.level
        val originalAdditivity = logger.isAdditive
        val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
        val configured = root.getAppender("JSON") as OutputStreamAppender<ILoggingEvent>
        val records = mutableListOf<Record>()
        val capture = object : AppenderBase<ILoggingEvent>() {
            override fun append(event: ILoggingEvent) {
                event.prepareForDeferredProcessing()
                records += Record(
                    configured.encoder.encode(event).decodeToString(),
                    (event.throwableProxy as? ThrowableProxy)?.throwable,
                )
            }
        }.apply { context = logger.loggerContext; start() }
        logger.level = ch.qos.logback.classic.Level.DEBUG
        logger.isAdditive = false
        logger.addAppender(capture)
        try {
            test(logger, records)
        } finally {
            logger.detachAppender(capture)
            capture.stop()
            logger.level = originalLevel
            logger.isAdditive = originalAdditivity
        }
    }
}
