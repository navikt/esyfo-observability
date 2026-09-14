import no.nav.esyfo.observability.Event
import no.nav.esyfo.observability.createLogger
import org.slf4j.LoggerFactory
import org.slf4j.event.Level

private data class FailureContext(val attempt: Int)

fun applicationEventRejectsWrongContext() {
    val event = Event<FailureContext>("job_failed", Level.ERROR, "Job failed")
    createLogger(LoggerFactory.getLogger("invalid-application-context")).event(event, "wrong context")
}
