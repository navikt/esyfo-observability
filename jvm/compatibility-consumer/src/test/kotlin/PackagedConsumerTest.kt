import ch.qos.logback.classic.Logger
import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.apiRequestRejected
import no.nav.esyfo.observability.emit
import no.nav.esyfo.observability.testkit.RuntimeLogContract
import no.nav.esyfo.observability.testkit.captureLogs
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PackagedConsumerTest {
    private enum class Reason { ACCESS_NOT_GRANTED }
    private data class Context(val reason: Reason)

    @Test
    fun `tests run on the selected runtime`() {
        assertEquals(System.getProperty("expectedJavaVersion"), Runtime.version().feature().toString())
    }

    @Test
    fun `published runtime and testkit work without project dependency or schema source tree`() {
        val logger = LoggerFactory.getLogger("packaged-consumer") as Logger
        val event = apiRequestRejected<Context>("validate_access", "Access not granted", { it.reason.name })
        val capture = captureLogs(logger, "JSON")
        capture.use { logger.emit(event, Context(Reason.ACCESS_NOT_GRANTED)) }
        RuntimeLogContract.forEvents(event, rejectionReasons = Reason.entries.map { it.name }.toSet())
            .assertValid(capture.records, expectedCount = 1)
        assertContains(capture.records.single(), "\"application\":\"packaged-consumer\"")
        assertTrue(Event::class.java.protectionDomain.codeSource.location.path.endsWith(".jar"))
        assertTrue(RuntimeLogContract::class.java.protectionDomain.codeSource.location.path.endsWith(".jar"))
        val bytes = requireNotNull(Event::class.java.getResourceAsStream("Event.class")).use { it.readBytes() }
        assertEquals(65, ((bytes[6].toInt() and 255) shl 8) or (bytes[7].toInt() and 255))
        val metadata = Event::class.java.getAnnotation(Metadata::class.java).metadataVersion
        assertEquals(listOf(2, 4), metadata.take(2))
    }
}
