package no.nav.esyfo.observability

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.AppenderBase
import ch.qos.logback.core.OutputStreamAppender
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.slf4j.event.Level
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertSame

class EventTest {
    private data class Failure(val upstreamStatus: Int)

    @Test
    fun `context cannot overwrite event fields logger fields or trace`() {
        for (reserved in listOf("event_type", "operation", "error_code", "level", "message", "stack_trace", "trace_id", "span_id")) {
            assertFailsWith<IllegalArgumentException>(reserved) {
                Event<Failure>("lookup_failed", Level.ERROR, "Lookup failed", fields = mapOf(reserved to { "override" }))
            }
        }
    }

    @Test
    fun `typed event preserves configured JSON cause and existing trace`() {
        val event = Event<Failure>(
            name = "altinn_lookup_failed",
            level = Level.ERROR,
            message = "Could not fetch Altinn access",
            operation = "fetch_altinn_access",
            errorCode = "ALTINN_UNAVAILABLE",
            fields = mapOf("upstream_status" to { it.upstreamStatus }),
        )
        val logger = LoggerFactory.getLogger("event-test") as Logger
        val original = IllegalStateException("Useful failure detail", IllegalArgumentException("Specific cause"))
        val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
        val configured = root.getAppender("JSON") as OutputStreamAppender<ILoggingEvent>
        val output = mutableListOf<String>()
        var capturedCause: Throwable? = null
        val capture = object : AppenderBase<ILoggingEvent>() {
            override fun append(loggingEvent: ILoggingEvent) {
                loggingEvent.prepareForDeferredProcessing()
                output += configured.encoder.encode(loggingEvent).decodeToString()
                capturedCause = (loggingEvent.throwableProxy as ch.qos.logback.classic.spi.ThrowableProxy).throwable
            }
        }.apply { context = logger.loggerContext; start() }
        logger.addAppender(capture)
        MDC.put("trace_id", "0123456789abcdef0123456789abcdef")
        try {
            logger.emit(event, Failure(503), cause = original)
            assertEquals("0123456789abcdef0123456789abcdef", MDC.get("trace_id"))
        } finally {
            MDC.remove("trace_id")
            logger.detachAppender(capture)
            capture.stop()
        }

        val json = output.single()
        assertContains(json, "\"event_type\":\"altinn_lookup_failed\"")
        assertContains(json, "\"upstream_status\":503")
        assertContains(json, "\"operation\":\"fetch_altinn_access\"")
        assertContains(json, "\"error_code\":\"ALTINN_UNAVAILABLE\"")
        assertContains(json, "\"application\":\"configured-test\"")
        assertContains(json, "\"trace_id\":\"0123456789abcdef0123456789abcdef\"")
        assertContains(json, "Useful failure detail")
        assertContains(json, "Specific cause")
        assertSame(original, capturedCause)
    }
}
