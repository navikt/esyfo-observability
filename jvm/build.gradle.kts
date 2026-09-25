plugins {
    base
    kotlin("jvm") version "2.4.20" apply false
}

allprojects {
    group = "no.nav.esyfo.observability"
    version = "0.3.0"
    repositories { mavenCentral() }
}

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "java-library")
    apply(plugin = "maven-publish")

    extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
        jvmToolchain(21)
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
            allWarningsAsErrors.set(true)
        }
        explicitApi()
    }
    extensions.configure<JavaPluginExtension> {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
        withSourcesJar()
    }
    val testLauncher = extensions.getByType<org.gradle.jvm.toolchain.JavaToolchainService>().launcherFor {
        languageVersion.set(JavaLanguageVersion.of(providers.gradleProperty("testJavaVersion").orElse("21").get()))
    }
    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        javaLauncher.set(testLauncher)
        systemProperty("expectedJavaVersion", providers.gradleProperty("testJavaVersion").orElse("21").get())
    }
    tasks.withType<Jar>().configureEach {
        from(rootProject.layout.projectDirectory.file("../LICENSE")) { into("META-INF") }
    }

    extensions.configure<PublishingExtension> {
        publications {
            create<MavenPublication>("mavenJava") {
                from(components["java"])
                artifactId = if (project.name == "logger") "esyfo-logger" else "esyfo-logger-testkit"
                pom {
                    name.set(artifactId)
                    description.set(if (project.name == "logger") "Typed local events for existing SLF4J loggers" else "Configured-encoder capture and runtime log contract assertions")
                    url.set("https://github.com/navikt/esyfo-observability")
                    licenses {
                        license {
                            name.set("MIT License")
                            url.set("https://opensource.org/license/mit")
                            distribution.set("repo")
                        }
                    }
                    scm {
                        url.set("https://github.com/navikt/esyfo-observability")
                        connection.set("scm:git:https://github.com/navikt/esyfo-observability.git")
                        developerConnection.set("scm:git:ssh://git@github.com/navikt/esyfo-observability.git")
                    }
                }
            }
        }
        repositories {
            maven {
                name = "Staging"
                url = uri(rootProject.layout.buildDirectory.dir("staging-repository"))
            }
        }
    }
}

tasks.check { dependsOn(subprojects.map { "${it.path}:check" }) }

val stagedPublications = subprojects.map { "${it.path}:publishAllPublicationsToStagingRepository" }
val stagedRepository = layout.buildDirectory.dir("staging-repository")
val consumerRuntime = providers.gradleProperty("testJavaVersion").orElse("21")
val verifyPackagedConsumer = tasks.register<Exec>("verifyPackagedConsumer") {
    dependsOn(stagedPublications)
    workingDir(layout.projectDirectory)
    commandLine(
        "./gradlew", "-p", "compatibility-consumer", "clean", "check", "--no-daemon",
        "-PlibraryVersion=${project.version}",
        "-PstagingRepository=${stagedRepository.get().asFile.absolutePath}",
        "-PtestJavaVersion=${consumerRuntime.get()}",
    )
}
tasks.check { dependsOn(verifyPackagedConsumer) }

abstract class VerifyRejectedContext @Inject constructor(
    private val execOperations: org.gradle.process.ExecOperations,
) : DefaultTask() {
    @get:Input
    abstract val command: ListProperty<String>

    @get:Internal
    abstract val workingDirectory: DirectoryProperty

    @TaskAction
    fun verify() {
        val output = java.io.ByteArrayOutputStream()
        val result = execOperations.exec {
            workingDir(workingDirectory.get().asFile)
            commandLine(command.get())
            isIgnoreExitValue = true
            standardOutput = output
            errorOutput = output
        }
        val diagnostic = output.toString(Charsets.UTF_8)
        check(result.exitValue != 0 && "Argument type mismatch" in diagnostic && "InvalidContext.kt" in diagnostic) {
            "The wrong-context fixture must fail with a Kotlin type mismatch; compiler output:\n$diagnostic"
        }
        check("InvalidApplicationContext.kt" in diagnostic && "InvalidDynamicCode.kt" in diagnostic &&
            "UnstructuredWarning.kt" in diagnostic && "Unresolved reference 'warn'" in diagnostic) {
            "Application logging must reject wrong context, non-string codes, and unnamed warnings; compiler output:\n$diagnostic"
        }
    }
}

val verifyRejectedContext = tasks.register<VerifyRejectedContext>("verifyRejectedContext") {
    dependsOn(verifyPackagedConsumer)
    workingDirectory.set(layout.projectDirectory)
    command.set(listOf(
        "./gradlew", "-p", "compatibility-consumer", "compileInvalidContextKotlin", "--no-daemon",
        "-PlibraryVersion=${project.version}",
        "-PstagingRepository=${stagedRepository.get().asFile.absolutePath}",
    ))
}
tasks.check { dependsOn(verifyRejectedContext) }
