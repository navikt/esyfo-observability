package no.nav.esyfo.observability.testkit

import ch.qos.logback.classic.Logger
import com.fasterxml.jackson.databind.ObjectMapper
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.slf4j.MDCContext
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.apiRequestRejected
import no.nav.esyfo.observability.emit
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.slf4j.event.Level
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OwnershipScenariosTest {
    private class AccessRejected : RuntimeException()
    private data class JobContext(val attempt: Int)

    @Test
    fun `Ktor application owns terminal rejection and successful fallback emits no rejection`() = testApplication {
        val logger = LoggerFactory.getLogger("request-owner") as Logger
        val rejected = apiRequestRejected<Unit>("validate_access", "Access was not granted", reason = { "ACCESS_NOT_GRANTED" })
        application {
            install(StatusPages) {
                exception<AccessRejected> { call, _ ->
                    logger.emit(rejected, Unit)
                    call.respondText("Forbidden", status = HttpStatusCode.Forbidden)
                }
            }
            routing {
                get("/{organizationAccess}/{fallbackAccess}") {
                    val organizationGranted = call.parameters["organizationAccess"] == "permit"
                    val fallbackGranted = call.parameters["fallbackAccess"] == "permit"
                    if (!organizationGranted && !fallbackGranted) throw AccessRejected()
                    call.respondText("Granted")
                }
            }
        }
        val capture = captureLogs(logger, "JSON")
        capture.use {
            assertEquals(HttpStatusCode.OK, client.get("/permit/deny").status)
            assertEquals(HttpStatusCode.OK, client.get("/deny/permit").status)
            assertTrue(capture.records.isEmpty())
            assertEquals(HttpStatusCode.Forbidden, client.get("/deny/deny").status)
        }
        RuntimeLogContract(
            mapOf("event_type" to setOf("api_request_rejected"), "operation" to setOf("validate_access"), "rejection_reason" to setOf("ACCESS_NOT_GRANTED")),
        ).assertValid(capture.records, expectedCount = 1)
        assertContains(capture.records.single(), "\"level\":\"WARN\"")
    }

    @Test
    fun `worker owns retry and terminal severity while cancellation remains cancellation`() = runBlocking {
        val logger = LoggerFactory.getLogger("worker-owner") as Logger
        val retry = Event<JobContext>("delivery_retry_scheduled", Level.WARN, "Delivery will be retried", fields = mapOf("attempt" to { it.attempt }))
        val failed = Event<JobContext>("delivery_failed", Level.ERROR, "Delivery attempts exhausted", fields = mapOf("attempt" to { it.attempt }))
        suspend fun runAttempt(attempt: Int, terminal: Boolean, work: suspend () -> Unit) {
            try {
                work()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                logger.emit(if (terminal) failed else retry, JobContext(attempt), cause = failure)
            }
        }
        val capture = captureLogs(logger, "JSON")
        capture.use {
            assertFailsWith<CancellationException> { runAttempt(1, false) { throw CancellationException("shutdown") } }
            assertTrue(capture.records.isEmpty())
            runAttempt(1, false) { throw IllegalStateException("Connection temporarily unavailable") }
            runAttempt(2, true) { throw IllegalStateException("Connection still unavailable") }
        }
        val records = capture.records.map { ObjectMapper().readTree(it) }
        assertEquals(listOf("WARN", "ERROR"), records.map { it.path("level").asText() })
        assertEquals(listOf("delivery_retry_scheduled", "delivery_failed"), records.map { it.path("event_type").asText() })
        assertContains(records.last().path("stack_trace").asText(), "Connection still unavailable")
        assertEquals(2, records.size)
    }

    @Test
    fun `caller supplied coroutine context survives suspension without leaking between jobs`() = runBlocking {
        val logger = LoggerFactory.getLogger("coroutine-owner") as Logger
        val event = Event<Unit>("job_failed", Level.ERROR, "Job failed")
        val traceIds = listOf("1234567890abcdef1234567890abcdef", "abcdef1234567890abcdef1234567890")
        val capture = captureLogs(logger, "JSON")
        capture.use {
            traceIds.map { traceId ->
                async(Dispatchers.Default + MDCContext(mapOf("trace_id" to traceId))) {
                    yield()
                    withContext(Dispatchers.IO) { logger.emit(event, Unit) }
                    assertEquals(traceId, MDC.get("trace_id"))
                }
            }.awaitAll()
        }
        val observed = capture.records.map { ObjectMapper().readTree(it).path("trace_id").asText() }
        assertEquals(traceIds.toSet(), observed.toSet())
        assertEquals(2, observed.size)
        assertNull(MDC.get("trace_id"))
    }
}
