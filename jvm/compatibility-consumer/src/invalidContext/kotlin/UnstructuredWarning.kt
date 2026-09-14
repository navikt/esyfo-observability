import no.nav.esyfo.observability.createLogger
import org.slf4j.LoggerFactory

fun applicationWarningRequiresAnEvent() {
    createLogger(LoggerFactory.getLogger("unstructured-warning")).warn("Missing event identity")
}
