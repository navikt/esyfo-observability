plugins { kotlin("jvm") }

repositories {
    exclusiveContent {
        forRepository {
            maven { url = uri(providers.gradleProperty("stagingRepository").get()) }
        }
        filter { includeGroup("no.nav.esyfo.observability") }
    }
    mavenCentral()
}

val libraryVersion = providers.gradleProperty("libraryVersion").get()
val invalidContext = sourceSets.create("invalidContext")
configurations[invalidContext.implementationConfigurationName].extendsFrom(configurations.implementation.get())

dependencies {
    implementation("no.nav.esyfo.observability:esyfo-logger:$libraryVersion")
    testImplementation("no.nav.esyfo.observability:esyfo-logger-testkit:$libraryVersion")
    testImplementation(kotlin("test-junit5"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.13.4")
    testImplementation("ch.qos.logback:logback-classic:1.6.3")
    testImplementation("net.logstash.logback:logstash-logback-encoder:9.0")
}

kotlin {
    jvmToolchain(21)
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21) }
}
java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}
tasks.test {
    useJUnitPlatform()
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(providers.gradleProperty("testJavaVersion").orElse("21").get()))
    })
    systemProperty("expectedJavaVersion", providers.gradleProperty("testJavaVersion").orElse("21").get())
}

val runtimeDependencies = configurations.runtimeClasspath
val verifyRuntimeDependencies = tasks.register("verifyRuntimeDependencies") {
    doLast {
        val allowedGroups = setOf("no.nav.esyfo.observability", "org.slf4j", "org.jetbrains.kotlin", "org.jetbrains")
        val modules = runtimeDependencies.get().incoming.resolutionResult.allComponents
            .filter { it.id is org.gradle.api.artifacts.component.ModuleComponentIdentifier }
            .mapNotNull { it.moduleVersion }
        check(modules.all { it.group in allowedGroups }) { "Logger runtime must not bring a backend, encoder, or JSON library" }
    }
}
tasks.check { dependsOn(verifyRuntimeDependencies) }
