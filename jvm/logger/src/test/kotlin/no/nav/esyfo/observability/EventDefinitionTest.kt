package no.nav.esyfo.observability

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.event.Level
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class EventDefinitionTest {
    private enum class Reason { SYSTEM_USER_ACCESS_NOT_GRANTED }
    private data class Rejection(val reason: Reason, val pdpDecision: String)

    @Test
    fun `absent top level metadata is omitted before encoding without altering nested diagnostics`() {
        val diagnostics = mapOf("message" to "Technical upstream error", "path" to null)
        val event = Event<Unit>(
            "lookup_failed", Level.ERROR, "Lookup failed",
            fields = mapOf("upstream_status" to { null }, "pdl_errors" to { diagnostics }),
        )
        val logger = LoggerFactory.getLogger("absent-metadata-test") as Logger
        val capture = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(capture)
        try {
            logger.emit(event)
        } finally {
            logger.detachAppender(capture)
            capture.stop()
        }
        assertEquals(
            mapOf("event_type" to "lookup_failed", "pdl_errors" to diagnostics),
            capture.list.single().keyValuePairs.associate { it.key to it.value },
        )
    }

    @Test
    fun `event without context can be emitted directly`() {
        val event = Event<Unit>("maintenance_completed", Level.INFO, "Maintenance completed")
        val logger = LoggerFactory.getLogger("unit-event-test") as Logger
        val capture = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(capture)
        try {
            logger.emit(event)
        } finally {
            logger.detachAppender(capture)
            capture.stop()
        }
        assertEquals("Maintenance completed", capture.list.single().formattedMessage)
    }

    @Test
    fun `disabled events do not evaluate context`() {
        var contextReads = 0
        val event = Event<Unit>("maintenance_completed", Level.INFO, "Maintenance completed", fields = mapOf("attempt" to { ++contextReads }))
        val logger = LoggerFactory.getLogger("disabled-event-test") as Logger
        val originalLevel = logger.level
        try {
            logger.level = ch.qos.logback.classic.Level.ERROR
            logger.emit(event)
        } finally {
            logger.level = originalLevel
        }
        assertEquals(0, contextReads)
    }

    @Test
    fun `invalid static definitions fail before any logging`() {
        assertFailsWith<IllegalArgumentException> { Event<Unit>("Not an event", Level.ERROR, "Failed") }
        assertFailsWith<IllegalArgumentException> { Event<Unit>("failed", Level.ERROR, " ") }
        assertFailsWith<IllegalArgumentException> { Event<Unit>("failed", Level.DEBUG, "Failed") }
        assertFailsWith<IllegalArgumentException> { Event<Unit>("failed", Level.TRACE, "Failed") }
        assertFailsWith<IllegalArgumentException> { Event<Unit>("failed", Level.ERROR, "Failed", operation = "/request/123") }
        assertFailsWith<IllegalArgumentException> { Event<Unit>("failed", Level.ERROR, "Failed", errorCode = "not-a-code") }
    }

    @Test
    fun `standard rejection has fixed warning semantics and local typed context without mandatory error code`() {
        val event = apiRequestRejected<Rejection>(
            operation = "validate_system_user_access",
            message = "System user access was not granted",
            reason = { it.reason.name },
            fields = mapOf("pdp_decision" to { it.pdpDecision }),
        )
        val logger = LoggerFactory.getLogger("rejection-test") as Logger
        val capture = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(capture)
        try {
            logger.emit(event, Rejection(Reason.SYSTEM_USER_ACCESS_NOT_GRANTED, "Deny"))
        } finally {
            logger.detachAppender(capture)
            capture.stop()
        }
        val record = capture.list.single()
        assertEquals(ch.qos.logback.classic.Level.WARN, record.level)
        assertEquals(
            mapOf(
                "event_type" to "api_request_rejected",
                "operation" to "validate_system_user_access",
                "rejection_reason" to "SYSTEM_USER_ACCESS_NOT_GRANTED",
                "pdp_decision" to "Deny",
            ),
            record.keyValuePairs.associate { it.key to it.value },
        )
    }
}
