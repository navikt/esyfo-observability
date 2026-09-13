import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.emit
import org.slf4j.LoggerFactory
import org.slf4j.event.Level

// This fixture must fail compilation against the packaged library.
private data class ExpectedContext(val attempt: Int)
private data class WrongContext(val value: String)

fun invalidContextMustNotCompile() {
    val event = Event<ExpectedContext>("job_failed", Level.ERROR, "Job failed")
    LoggerFactory.getLogger("invalid-context").emit(event, WrongContext("wrong type"))
}
