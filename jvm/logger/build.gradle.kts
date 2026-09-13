plugins {
    kotlin("jvm")
    `java-library`
}

base { archivesName.set("esyfo-logger") }

dependencies {
    api("org.slf4j:slf4j-api:2.0.17")
    testImplementation(kotlin("test-junit5"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")
    testImplementation("ch.qos.logback:logback-classic:1.6.3")
    testImplementation("net.logstash.logback:logstash-logback-encoder:9.0")
}
