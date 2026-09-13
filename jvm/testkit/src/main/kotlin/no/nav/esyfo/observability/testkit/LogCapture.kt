package no.nav.esyfo.observability.testkit

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.AppenderBase
import ch.qos.logback.core.OutputStreamAppender
import ch.qos.logback.core.encoder.Encoder

/**
 * Captures UTF-8 JSON using an already configured appender's encoder, without replacing its stream.
 * The named appender must be attached to [logger] or its root logger. The capture observes logger
 * events, not downstream appender filters or transport delivery. Do not run captures in parallel
 * against the same logger context; use isolated contexts for concurrent tests.
 */
public fun captureLogs(logger: Logger, appenderName: String): LogCapture {
    val root = logger.loggerContext.getLogger(Logger.ROOT_LOGGER_NAME)
    val configured = logger.getAppender(appenderName) ?: root.getAppender(appenderName)
    require(configured is OutputStreamAppender<ILoggingEvent>) {
        "The named appender must be a configured OutputStreamAppender on the logger or root"
    }
    val encoder = requireNotNull(configured.encoder) { "The configured appender has no encoder" }
    require(encoder.isStarted) { "The configured encoder must already be started" }
    val capture = EncodingCapture(encoder).apply {
        context = logger.loggerContext
        start()
    }
    logger.addAppender(capture)
    return LogCapture(logger, capture)
}

/** Capture remains readable after close; closing detaches only its own appender. */
public class LogCapture internal constructor(
    private val logger: Logger,
    private val capture: EncodingCapture,
) : AutoCloseable {
    public val records: List<String> get() = capture.snapshot()

    override fun close() {
        logger.detachAppender(capture)
        capture.stop()
    }
}

internal class EncodingCapture(private val encoder: Encoder<ILoggingEvent>) : AppenderBase<ILoggingEvent>() {
    private val encodedRecords = mutableListOf<String>()

    override fun append(event: ILoggingEvent) {
        // Freeze lazy MDC/message fields while the emitting thread still has the right context.
        event.prepareForDeferredProcessing()
        synchronized(encodedRecords) {
            encodedRecords += encoder.encode(event).decodeToString().trimEnd('\r', '\n')
        }
    }

    fun snapshot(): List<String> = synchronized(encodedRecords) { encodedRecords.toList() }
}
