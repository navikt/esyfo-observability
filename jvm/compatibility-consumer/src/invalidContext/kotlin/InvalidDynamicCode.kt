import no.nav.esyfo.observability.Event
import org.slf4j.event.Level

fun dynamicCodeRejectsNonStringResult() {
    Event<Unit>("job_failed", Level.ERROR, "Job failed", errorCodeFrom = { 503 })
}
