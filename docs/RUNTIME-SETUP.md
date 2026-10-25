# Set up test tools

Open **Runtimes & diagnostics** and choose **Set up** beside a tool, or **Download test tools** to see the list. The AI board has a **Set up tools** button; each agent chat also has **Set up**. These open the same window.

1. Choose a tool and select **Review setup**.
2. Read the publisher, download, destination and any project changes.
3. Choose **Download & set up**. Follow the progress or open the log.
4. Wait for the result. LVX checks the tool before showing **Ready**.

Close the setup window to return to your work. Downloads continue while the app stays open. Open setup again to see progress and recent activity. **Cancel setup** stops a download or package command; the final save of verified settings is a short step that cannot be cancelled. Closing the app interrupts active downloads; they do not resume automatically.

## Available tools

| Tool | What setup does |
|---|---|
| Python | Downloads Python 3.13 into LVX local storage. |
| Java JDK | Downloads the Eclipse Temurin 21 JDK, including the compiler. |
| .NET SDK | Downloads the current stable .NET 10 SDK. |
| Website test browser | Downloads Chromium matching the bundled Playwright version, then launches it to check it. |
| pytest | Creates an LVX Python installation with pytest 8.4.2. |
| Robot Framework | Creates an LVX Python installation with Robot Framework 7.3.2. |
| JUnit runner | Downloads JUnit Platform Console 1.11.4; adds a JDK if none is available. |
| Jest project packages | Downloads a Node 24 LTS bootstrap and adds Jest 29.7.0 to your project's package.json and lock file. It does not change LVX's internal Node runner. |
| NUnit project packages | Adds Microsoft.NET.Test.Sdk 17.13.0, NUnit 4.3.2 and NUnit3TestAdapter 5.0.0 to one existing .csproj, then checks test discovery. Set up .NET first. |

In-app downloads support Windows x64. They need an internet connection and enough free space. Large SDK downloads can take several minutes. **Publisher instructions** opens the official setup guide if you prefer to manage a tool yourself.

Runtimes live under the app's local data folder (`studio/setup/installs`). LVX does not change system PATH, uninstall your existing tools or install global packages. A new verified runtime becomes LVX's selected runtime for that language. Earlier successful installations remain available on disk; LVX does not delete a runtime that another saved path may still use. Failed or cancelled download files are removed. Diagnostics also lets you choose your own installed runtime locations.

Jest and NUnit modify the selected project, so choose a folder you trust. LVX keeps a `.before` copy of the dependency file in the setup log folder. Package tools may also create a lock file, node_modules, obj or bin. If cancelled or unsuccessful, package changes can remain; inspect the log and backup before retrying. NUnit package restore can run trusted project build targets. A project targeting an older .NET version may need that matching runtime; setup reports **Needs attention** if test discovery does not work.

## Ask an agent

Choose **Ask an AI agent for help**, select a saved agent and write your question. The agent uses its existing provider connection. Open **Message that will be sent** to read the exact message. Tool availability is shared only when you check its box.

The agent can suggest setup buttons. Each button opens a fixed tool plan; it does not run an installation. Review and start the download yourself. Your provider's normal account limits or charges apply. An AI account is not needed for the download buttons.

## Download checks

Python, Java, .NET, Node and JUnit archives are checked against their published SHA-256 or SHA-512 checksums before use. Downloads follow a fixed HTTPS source catalog. Archive paths are checked before extraction, and the installed executables are probed before activation. Changing runtime locations during a download preserves your newer choice.

The browser uses Playwright's pinned revision over HTTPS and a real launch check; it has no separate publisher checksum in this flow. npm, pip and NuGet use their official registries and package tooling. These package flows have different verification guarantees from the direct archive checks.

Official guides: [Python](https://docs.python.org/3/using/windows.html#the-nuget-org-packages), [Adoptium](https://adoptium.net/installation/), [.NET](https://learn.microsoft.com/en-us/dotnet/core/install/windows), [Playwright](https://playwright.dev/docs/browsers), [pytest](https://docs.pytest.org/en/stable/getting-started.html), [Robot Framework](https://robotframework.org/), [JUnit](https://junit.org/junit5/docs/5.11.4/user-guide/), [Jest](https://jestjs.io/docs/getting-started), [NUnit](https://docs.nunit.org/articles/nunit/getting-started/installation.html).
