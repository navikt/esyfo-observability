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
import org.slf4j.spi.LoggingEventBuilder
import java.util.concurrent.CancellationException
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFails
import kotlin.test.assertFailsWith
import kotlin.test.assertSame

class ApplicationLoggerTest {
    private enum class FailureCode { UPSTREAM_UNAVAILABLE, INVALID_RESPONSE }

    @Test
    fun `field reader failure preserves the original outcome and remaining event context`() {
        val original = IllegalStateException("Original upstream failure")
        val event = Event<Unit>(
            "plan_fetch_failed", Level.ERROR, "Could not fetch plan",
            operation = "fetch_plan", errorCode = "UPSTREAM_UNAVAILABLE",
            fields = mapOf(
                "attempt" to { 2 },
                "broken" to { error("private-reader-value") },
                "pdl_errors" to { listOf(mapOf("code" to "not_found", "message" to "Safe PDL diagnostic")) },
            ),
        )
        capture { native, records ->
            val log = createLogger(native)
            val propagated = assertFailsWith<IllegalStateException> {
                try {
                    throw original
                } catch (failure: IllegalStateException) {
                    log.event(event, cause = failure)
                    throw failure
                }
            }
            assertSame(original, propagated)
            val record = records.single()
            assertSame(original, record.cause)
            assertContains(record.json, "\"event_type\":\"plan_fetch_failed\"")
            assertContains(record.json, "\"operation\":\"fetch_plan\"")
            assertContains(record.json, "\"error_code\":\"UPSTREAM_UNAVAILABLE\"")
            assertContains(record.json, "\"attempt\":2")
            assertContains(record.json, "Safe PDL diagnostic")
            assertContains(record.json, "\"logging_context_invalid\":true")
            assertFalse("broken" in record.json)
            assertFalse("private-reader-value" in record.json)
        }
    }

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
    fun `static and dynamic codes are mutually exclusive at setup`() {
        assertFailsWith<IllegalArgumentException> {
            Event<Unit>("plan_fetch_failed", Level.ERROR, "Could not fetch plan", errorCode = "STATIC_CODE", errorCodeFrom = { "DYNAMIC_CODE" })
        }
    }

    @Test
    fun `invalid or throwing dynamic code is omitted without losing the event or cause`() {
        val original = IllegalStateException("Original upstream failure")
        val event = Event<String>(
            "plan_fetch_failed", Level.ERROR, "Could not fetch plan",
            errorCodeFrom = { if (it == "THROW_READER_CANARY") error("private-reader-value") else it },
            fields = mapOf("upstream_status" to { 503 }),
        )
        capture { native, records ->
            val log = createLogger(native)
            for (code in listOf("", "not-a-code", "P".repeat(81), "THROW_READER_CANARY")) {
                log.event(event, code, original)
                val record = records.last()
                assertSame(original, record.cause)
                assertContains(record.json, "\"event_type\":\"plan_fetch_failed\"")
                assertContains(record.json, "\"upstream_status\":503")
                assertContains(record.json, "\"logging_context_invalid\":true")
                assertFalse("error_code" in record.json)
                assertFalse("private-reader-value" in record.json)
                assertFalse(code.isNotEmpty() && code in record.json)
            }
            assertEquals(4, records.size)
        }
    }

    @Test
    fun `multiple failing readers are isolated and add only one invalid context marker`() {
        val reads = mutableListOf<String>()
        val event = Event<Unit>(
            "plan_fetch_failed", Level.ERROR, "Could not fetch plan",
            errorCodeFrom = { reads += "code"; error("private-code-reader") },
            fields = mapOf(
                "first" to { reads += "first"; error("private-first-reader") },
                "count" to { reads += "count"; 3 },
                "last" to { reads += "last"; error("private-last-reader") },
            ),
        )
        capture { native, records ->
            createLogger(native).event(event)
            assertEquals(listOf("code", "first", "count", "last"), reads)
            val record = records.single()
            assertContains(record.json, "\"count\":3")
            assertContains(record.json, "\"logging_context_invalid\":true")
            assertEquals(1, Regex("\"logging_context_invalid\":").findAll(record.json).count())
            assertFalse("private-" in record.json)
            assertFalse("error_code" in record.json)
            assertFalse("\"first\":" in record.json)
            assertFalse("\"last\":" in record.json)
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
    fun `diagnostics omit invalid fields individually and retain valid fields on the same record`() {
        capture { native, records ->
            val log = createLogger(native)
            for (field in listOf("event_type", "error_code", "operation", "rejection_reason", "level", "message", "trace_id", "stack_trace", "logging_context_invalid")) {
                log.info("Diagnostic", mapOf("before" to 1, field to "private-field-value", "after" to 2))
                assertFalse("private-field-value" in records.last().json)
                log.debug("Diagnostic", mapOf("before" to 1, field to null, "after" to 2))
            }
            for (value in listOf(IllegalStateException("private cause"), mapOf("nested" to "payload"), listOf(1), Double.NaN, Float.POSITIVE_INFINITY)) {
                log.info("Diagnostic", mapOf("before" to 1, "detail" to value, "after" to 2))
                assertFalse("detail" in records.last().json)
                assertFalse("private cause" in records.last().json)
            }
            assertEquals(23, records.size)
            records.forEach { record ->
                assertContains(record.json, "\"before\":1")
                assertContains(record.json, "\"after\":2")
                assertContains(record.json, "\"message\":\"Diagnostic\"")
                assertContains(record.json, "\"logging_context_invalid\":true")
                assertEquals(1, Regex("\"logging_context_invalid\":").findAll(record.json).count())
            }
            log.info(" ")
            assertContains(records.last().json, "\"message\":\" \"")
            assertFalse("logging_context_invalid" in records.last().json)
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
    fun `throwing diagnostic entries are omitted while later entries remain readable`() {
        val broken = object : Map.Entry<String, Any?> {
            override val key: String get() = "broken"
            override val value: Any? get() = error("private-entry-value")
        }
        val fields = object : AbstractMap<String, Any?>() {
            override val entries = mapOf("before" to 1).entries + broken + mapOf("after" to 2).entries
        }
        capture { native, records ->
            createLogger(native).info("Diagnostic", fields)
            val record = records.single()
            assertContains(record.json, "\"before\":1")
            assertContains(record.json, "\"after\":2")
            assertContains(record.json, "\"logging_context_invalid\":true")
            assertFalse("broken" in record.json)
            assertFalse("private-entry-value" in record.json)
        }
    }

    @Test
    fun `cancellation interruption and JVM errors from context are not converted to diagnostics`() {
        capture { native, records ->
            val log = createLogger(native)
            for (failure in listOf(CancellationException("Cancelled"), InterruptedException("Interrupted"), AssertionError("JVM error"))) {
                val code = Event<Unit>("job_failed", Level.ERROR, "Job failed", errorCodeFrom = { throw failure })
                val field = Event<Unit>("job_failed", Level.ERROR, "Job failed", fields = mapOf("attempt" to { throw failure }))
                val diagnostic = object : AbstractMap<String, Any?>() {
                    override val entries: Set<Map.Entry<String, Any?>> get() = throw failure
                }
                assertSame(failure, assertFails { log.event(code) })
                assertSame(failure, assertFails { log.event(field) })
                assertSame(failure, assertFails { log.info("Diagnostic", diagnostic) })
            }
            assertEquals(0, records.size)
        }
    }

    @Test
    fun `native logger failures propagate without a fallback attempt`() {
        capture { native, records ->
            val failure = IllegalStateException("Native logger failure")
            val event = Event<Unit>("job_failed", Level.ERROR, "Job failed")
            for (stage in listOf("builder", "field", "log")) {
                var attempts = 0
                val broken = object : org.slf4j.Logger by native {
                    override fun atLevel(level: Level): LoggingEventBuilder {
                        attempts++
                        if (stage == "builder") throw failure
                        val builder = native.atLevel(level)
                        return object : LoggingEventBuilder by builder {
                            override fun addKeyValue(key: String, value: Any?): LoggingEventBuilder {
                                if (stage == "field") throw failure
                                builder.addKeyValue(key, value)
                                return this
                            }

                            override fun log(message: String) {
                                throw failure
                            }
                        }
                    }
                }
                val log = createLogger(broken)
                assertSame(failure, assertFails { log.event(event) })
                assertEquals(1, attempts)
                assertSame(failure, assertFails { log.info("Diagnostic", mapOf("count" to 1)) })
                assertEquals(2, attempts)
            }
            assertEquals(0, records.size)
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
