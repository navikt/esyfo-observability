plugins {
    kotlin("jvm")
    `java-library`
}

base { archivesName.set("esyfo-logger-testkit") }

dependencies {
    api(project(":logger"))
    compileOnly("ch.qos.logback:logback-classic:1.6.3")
    implementation("com.networknt:json-schema-validator:3.0.8")
    implementation("tools.jackson.core:jackson-databind:3.2.2")
    testImplementation(kotlin("test-junit5"))
    testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")
    testImplementation("ch.qos.logback:logback-classic:1.6.3")
    testImplementation("net.logstash.logback:logstash-logback-encoder:9.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-slf4j:1.11.0")
    testImplementation("io.ktor:ktor-server-test-host:3.5.2")
    testImplementation("io.ktor:ktor-server-status-pages:3.5.2")
}

tasks.processResources {
    from(rootProject.layout.projectDirectory.dir("../contracts/runtime-error/v1.0.0")) {
        into("contracts/runtime-error/v1.0.0")
    }
}

tasks.processTestResources {
    from(rootProject.layout.projectDirectory.dir("../contracts/runtime-error/fixtures")) {
        into("contracts/runtime-error/fixtures")
    }
}
