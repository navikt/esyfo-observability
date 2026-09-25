package no.nav.esyfo.observability

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.AppenderBase
import ch.qos.logback.core.OutputStreamAppender
import java.sql.SQLException
import java.util.concurrent.CancellationException
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.event.Level
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

private open class HttpClientErrorException(message: String? = null) : RuntimeException(message) {
    class Forbidden : HttpClientErrorException("PRIVATE_nested")
}

class FailureFieldsTest {
    private class OddlyNamedFailure : RuntimeException("PRIVATE_odd")

    private data class Context(val failure: Throwable?, val status: Int?)

    @Test
    fun `categories use class hierarchy without messages`() {
        val nested = HttpClientErrorException.Forbidden()
        assertEquals("HttpClientErrorException", nested.exceptionType())
        assertEquals("IllegalStateException", (object : IllegalStateException("PRIVATE_anonymous") {}).exceptionType())
        assertEquals("RuntimeException", OddlyNamedFailure().exceptionType())
        assertEquals("Exception", Throwable("PRIVATE_fallback").exceptionType())
        assertEquals("IllegalArgumentException", RuntimeException("PRIVATE_outer", IllegalArgumentException("PRIVATE_inner")).causeType())
        assertTrue(EXCEPTION_PATTERN.matches(nested.exceptionType()))
    }

    @Test
    fun `cause traversal stops on identity cycles and at sixteen`() {
        val first = Throwable("PRIVATE_first")
        val second = Throwable("PRIVATE_second")
        first.initCause(second)
        second.initCause(first)
        assertEquals(listOf(first, second), first.causeChain())
        assertEquals("Exception", first.causeType())

        var chain: Throwable = SQLException("PRIVATE_deep", "ABCDE")
        repeat(17) { chain = IllegalStateException("PRIVATE_wrapper", chain) }
        assertEquals(16, chain.causeChain().size)
        assertSame(chain, chain.causeChain().first())
        assertNull(chain.sqlState())
    }

    @Test
    fun `sql state and upstream status accept only contract values`() {
        val valid = SQLException("PRIVATE_valid", "A1234")
        val invalid = SQLException("PRIVATE_invalid", "private", valid)
        assertEquals("A1234", RuntimeException("PRIVATE_wrapper", invalid).sqlState())
        assertEquals("A1234", valid.sqlState())
        assertNull(SQLException("PRIVATE_invalid", "a1234").sqlState())
        assertNull(SQLException("PRIVATE_invalid", "123456").sqlState())
        assertNull(IllegalStateException("PRIVATE_none").sqlState())
        listOf(99, 600, null).forEach { assertNull(validUpstreamStatus(it)) }
        listOf(100, 599).forEach { assertEquals(it, validUpstreamStatus(it)) }
    }

    @Test
    fun `cancellation rethrows the original instance and restores interruption`() {
        val cancellation = CancellationException("PRIVATE_cancel")
        assertTrue(cancellation.isCancellation())
        assertTrue(RuntimeException("PRIVATE_wrapper", cancellation).isCancellation())
        assertFalse(RuntimeException("PRIVATE_other").isCancellation())
        assertSame(cancellation, runCatching { RuntimeException(cancellation).rethrowIfCancelled() }.exceptionOrNull())
        val interruption = InterruptedException("PRIVATE_interrupted")
        try {
            Thread.interrupted()
            assertSame(interruption, runCatching { RuntimeException(interruption).rethrowIfCancelled() }.exceptionOrNull())
            assertTrue(Thread.currentThread().isInterrupted)
        } finally {
            Thread.interrupted()
        }
        RuntimeException("PRIVATE_normal").rethrowIfCancelled()
    }

    @Test
    fun `failure fields emit through configured Logstash encoder without private messages`() {
        val logger = LoggerFactory.getLogger("failure-fields-test") as Logger
        val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
        val configured = root.getAppender("JSON") as OutputStreamAppender<ILoggingEvent>
        val output = mutableListOf<String>()
        val capture = object : AppenderBase<ILoggingEvent>() {
            override fun append(event: ILoggingEvent) {
                event.prepareForDeferredProcessing()
                output += configured.encoder.encode(event).decodeToString()
            }
        }.apply { context = logger.loggerContext; start() }
        val event = Event<Context>(
            "plan_fetch_failed", Level.ERROR, "Kunne ikke hente plan",
            fields = failureFields<Context>({ it.failure }, { it.status }) +
                mapOf("attempt" to { context: Context -> 1 }),
        )
        val context = Context(SQLException("PRIVATE_sql_message", "ABCDE", OddlyNamedFailure()), 503)
        logger.addAppender(capture)
        try {
            logger.emit(event, context)
            logger.emit(event, Context(null, 99))
        } finally {
            logger.detachAppender(capture)
            capture.stop()
        }

        assertEquals(2, output.size)
        assertContains(output[0], "\"exception_type\":\"SQLException\"")
        assertContains(output[0], "\"cause_type\":\"RuntimeException\"")
        assertContains(output[0], "\"sql_state\":\"ABCDE\"")
        assertContains(output[0], "\"upstream_status\":503")
        assertContains(output[0], "\"attempt\":1")
        assertFalse("PRIVATE_" in output.joinToString())
        listOf("exception_type", "cause_type", "sql_state", "upstream_status").forEach {
            assertFalse("\"$it\"" in output[1])
        }
        context.failure?.let { assertEquals("SQLException", it.exceptionType()) }
    }

    private companion object {
        val EXCEPTION_PATTERN = Regex("^([A-Za-z][A-Za-z0-9_.:\$]{0,143})?(Error|Exception)$")
    }
}
