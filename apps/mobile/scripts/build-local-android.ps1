[CmdletBinding()]
param(
    [string]$OutputPath,
    [string]$CredentialsDirectory = (Join-Path $env:LOCALAPPDATA 'BillManager\android-signing'),
    [string]$WslDistribution = 'Ubuntu',
    [switch]$KeepStaging
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$Executable,
        [Parameter(ValueFromRemainingArguments)]
        [string[]]$Arguments
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
    }
}

function Stop-IsolatedGradleDaemon {
    param(
        [Parameter(Mandatory)]
        [string]$Marker
    )

    # This build gives its daemon a unique JVM marker. Gradle 9.3.1 can leave
    # completed Windows daemons holding generated JARs open, so terminate only
    # that isolated process tree after Gradle has returned the build result.
    Start-Sleep -Milliseconds 1500
    $allProcesses = Get-CimInstance Win32_Process
    $daemonRoots = @($allProcesses | Where-Object {
        $_.Name -ieq 'java.exe' -and
        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
        $_.CommandLine.IndexOf(
            'org.gradle.launcher.daemon.bootstrap.GradleDaemon',
            [System.StringComparison]::Ordinal
        ) -ge 0 -and
        $_.CommandLine.IndexOf($Marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })

    foreach ($daemonRoot in $daemonRoots) {
        $processIds = New-Object System.Collections.Generic.List[int]
        function Add-GradleDescendants([int]$ParentId) {
            foreach ($child in $allProcesses | Where-Object { $_.ParentProcessId -eq $ParentId }) {
                Add-GradleDescendants -ParentId $child.ProcessId
                $processIds.Add([int]$child.ProcessId)
            }
        }

        Add-GradleDescendants -ParentId $daemonRoot.ProcessId
        $processIds.Add([int]$daemonRoot.ProcessId)
        foreach ($processId in $processIds) {
            if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
                Stop-Process -Id $processId -Force -ErrorAction Stop
            }
        }
        Start-Sleep -Milliseconds 500
    }
}

$mobileRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$repoRoot = (Resolve-Path (Join-Path $mobileRoot '..\..')).ProviderPath
$repoPrefix = '\\wsl$\' + $WslDistribution + '\'
if (-not $repoRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Expected the source checkout under $repoPrefix so WSL-native Git can create the build snapshot."
}

$repoWslPath = '/' + $repoRoot.Substring($repoPrefix.Length).Replace('\', '/')

$javaHome = 'C:\Program Files\Android\Android Studio\jbr'
$androidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$requiredPaths = @(
    (Join-Path $javaHome 'bin\java.exe'),
    (Join-Path $androidSdk 'platforms\android-36\android.jar'),
    (Join-Path $androidSdk 'build-tools\36.0.0\aapt2.exe'),
    (Join-Path $androidSdk 'build-tools\36.1.0\aapt2.exe'),
    (Join-Path $androidSdk 'build-tools\36.1.0\apksigner.bat'),
    (Join-Path $androidSdk 'build-tools\36.1.0\zipalign.exe'),
    (Join-Path $androidSdk 'cmake\3.22.1\bin\cmake.exe'),
    (Join-Path $androidSdk 'cmake\3.30.5\bin\cmake.exe'),
    (Join-Path $androidSdk 'ndk\27.0.12077973\source.properties'),
    (Join-Path $androidSdk 'ndk\27.1.12297006\source.properties')
)
foreach ($requiredPath in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required local Android build dependency is missing: $requiredPath"
    }
}

$credentialsPath = Join-Path $CredentialsDirectory 'credentials.json'
$keystorePath = Join-Path $CredentialsDirectory 'keystore.jks'
if (-not (Test-Path -LiteralPath $credentialsPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
    throw "Android signing credentials are missing from $CredentialsDirectory. Download the existing EAS Android credentials before building."
}
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json

$requestedOutputFullPath = $null
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $requestedOutputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
}

$buildRoot = 'C:\bm'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$shortBuildId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$stagingPath = Join-Path $buildRoot $shortBuildId
New-Item -ItemType Directory -Path $stagingPath | Out-Null
$archivePath = Join-Path $stagingPath 'source.tar'
$archiveWslPath = $null
if ($archivePath -match '^([A-Za-z]):\\(.*)$') {
    $driveLetter = $Matches[1].ToLowerInvariant()
    $archiveWslPath = "/mnt/$driveLetter/" + $Matches[2].Replace('\', '/')
}
if ([string]::IsNullOrWhiteSpace($archiveWslPath)) {
    throw "Could not translate the Windows staging path for WSL: $archivePath"
}

$savedEnvironment = @{}
$signingEnvironmentNames = @(
    'BILLMANAGER_ANDROID_KEY_ALIAS',
    'BILLMANAGER_ANDROID_KEY_PASSWORD',
    'BILLMANAGER_ANDROID_KEYSTORE',
    'BILLMANAGER_ANDROID_STORE_PASSWORD'
)
$environmentNames = @(
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'BILLMANAGER_DEVELOPMENT_BUILD',
    'CI',
    'EAS_BUILD_PROFILE',
    'EXPO_PUBLIC_DESIGN_PLATFORM',
    'EXPO_PUBLIC_DESIGN_PREVIEW',
    'JAVA_HOME',
    'NODE_ENV',
    'PATH'
) + $signingEnvironmentNames
foreach ($name in $environmentNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$buildSucceeded = $false
$locationPushed = $false
$localGradleInvoked = $false
$localGradleDaemonStopped = $false
try {
    Write-Host "Creating a clean committed-source snapshot at $stagingPath"
    Invoke-Checked -Executable 'wsl.exe' -Arguments @(
        '-d', $WslDistribution, '--', 'git', '-C', $repoWslPath,
        'archive', '--format=tar', 'HEAD', '-o', $archiveWslPath
    )
    Invoke-Checked -Executable 'tar.exe' -Arguments @('-xf', $archivePath, '-C', $stagingPath)
    Remove-Item -LiteralPath $archivePath -Force

    $stagedMobile = Join-Path $stagingPath 'apps\mobile'
    $stagedPackagePath = Join-Path $stagedMobile 'package.json'
    $stagedEasPath = Join-Path $stagedMobile 'eas.json'
    if (-not (Test-Path -LiteralPath (Join-Path $stagedMobile 'package-lock.json') -PathType Leaf) -or
        -not (Test-Path -LiteralPath $stagedPackagePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $stagedEasPath -PathType Leaf)) {
        throw 'The staged mobile project is incomplete.'
    }

    # Derive the toolchain and output label from the exact committed snapshot
    # used for the APK, never from potentially uncommitted checkout metadata.
    $package = Get-Content -LiteralPath $stagedPackagePath -Raw | ConvertFrom-Json
    $easConfig = Get-Content -LiteralPath $stagedEasPath -Raw | ConvertFrom-Json
    $nodeVersion = [string]$easConfig.build.preview.node
    if ([string]::IsNullOrWhiteSpace($nodeVersion) -or
        [string]::IsNullOrWhiteSpace([string]$package.version)) {
        throw 'The committed mobile version or preview Node.js version is missing.'
    }
    $nodeHome = Join-Path $env:LOCALAPPDATA "nvm\v$nodeVersion"
    $node = Join-Path $nodeHome 'node.exe'
    $npm = Join-Path $nodeHome 'npm.cmd'
    foreach ($requiredNodePath in @($node, $npm)) {
        if (-not (Test-Path -LiteralPath $requiredNodePath -PathType Leaf)) {
            throw "Required committed-snapshot Node.js dependency is missing: $requiredNodePath"
        }
    }

    $env:ANDROID_HOME = $androidSdk
    $env:ANDROID_SDK_ROOT = $androidSdk
    $env:BILLMANAGER_DEVELOPMENT_BUILD = 'false'
    $env:CI = '1'
    $env:EAS_BUILD_PROFILE = 'preview'
    [Environment]::SetEnvironmentVariable('EXPO_PUBLIC_DESIGN_PLATFORM', $null, 'Process')
    $env:EXPO_PUBLIC_DESIGN_PREVIEW = '0'
    $env:JAVA_HOME = $javaHome
    $env:NODE_ENV = 'production'
    $env:PATH = "$nodeHome;$javaHome\bin;$androidSdk\platform-tools;$($savedEnvironment['PATH'])"
    foreach ($name in $signingEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }

    Push-Location $stagedMobile
    $locationPushed = $true
    Write-Host "Installing Windows dependencies with Node $nodeVersion"
    Invoke-Checked -Executable $npm -Arguments @('ci', '--no-audit', '--no-fund')
    Write-Host 'Generating the disposable Android project'
    Invoke-Checked -Executable $npm -Arguments @('run', 'prebuild', '--', '--platform', 'android')

    $stagedAndroid = Join-Path $stagedMobile 'android'
    $manifestPath = Join-Path $stagedAndroid 'app\src\main\AndroidManifest.xml'
    $androidNamespace = 'http://schemas.android.com/apk/res/android'
    $manifestDocument = [System.Xml.XmlDocument]::new()
    $manifestDocument.PreserveWhitespace = $true
    $manifestDocument.Load($manifestPath)
    $namespaceManager = [System.Xml.XmlNamespaceManager]::new($manifestDocument.NameTable)
    $namespaceManager.AddNamespace('android', $androidNamespace)
    $updatesEnabledNodes = @($manifestDocument.SelectNodes(
        '/manifest/application/meta-data[@android:name="expo.modules.updates.ENABLED"]',
        $namespaceManager
    ))
    if ($updatesEnabledNodes.Count -ne 1) {
        throw 'Expected exactly one Expo Updates setting in the generated Android manifest.'
    }
    [void]$updatesEnabledNodes[0].SetAttribute('value', $androidNamespace, 'false')
    $xmlSettings = [System.Xml.XmlWriterSettings]::new()
    $xmlSettings.Encoding = [System.Text.UTF8Encoding]::new($false)
    $xmlSettings.Indent = $true
    $xmlSettings.OmitXmlDeclaration = $true
    $xmlWriter = [System.Xml.XmlWriter]::Create($manifestPath, $xmlSettings)
    try {
        $manifestDocument.Save($xmlWriter)
    }
    finally {
        $xmlWriter.Dispose()
    }

    $sdkEscaped = $androidSdk.Replace('\', '\\').Replace(':', '\:')
    [System.IO.File]::WriteAllText(
        (Join-Path $stagedAndroid 'local.properties'),
        "sdk.dir=$sdkEscaped`r`n",
        [System.Text.UTF8Encoding]::new($false)
    )

    # A direct phone-test APK only needs the ABI used by current Android phones.
    # Keep Gradle deliberately serial here: the generated Expo project enables
    # parallel compilation, which can exhaust or deadlock Windows worker pools.
    $gradlePropertiesPath = Join-Path $stagedAndroid 'gradle.properties'
    $gradleProperties = Get-Content -LiteralPath $gradlePropertiesPath -Raw
    $gradleDaemonMarker = '-XX:ErrorFile=' + $stagingPath.Replace('\', '/') + '/gradle-hs-err-pid.log'
    $gradlePropertyOverrides = [ordered]@{
        'org.gradle.daemon.idletimeout' = '1000'
        'org.gradle.jvmargs'        = "-Xmx3072m -XX:MaxMetaspaceSize=1024m $gradleDaemonMarker"
        'org.gradle.parallel'       = 'false'
        'reactNativeArchitectures' = 'arm64-v8a'
    }
    foreach ($propertyName in $gradlePropertyOverrides.Keys) {
        $propertyValue = $gradlePropertyOverrides[$propertyName]
        $propertyPattern = '(?m)^' + [regex]::Escape($propertyName) + '=.*$'
        $propertyReplacement = "$propertyName=$propertyValue"
        if ([regex]::IsMatch($gradleProperties, $propertyPattern)) {
            $gradleProperties = [regex]::Replace(
                $gradleProperties,
                $propertyPattern,
                $propertyReplacement,
                1
            )
        }
        else {
            $gradleProperties = $gradleProperties.TrimEnd() + "`r`n$propertyReplacement`r`n"
        }
    }
    [System.IO.File]::WriteAllText(
        $gradlePropertiesPath,
        $gradleProperties,
        [System.Text.UTF8Encoding]::new($false)
    )

    $gradlePath = Join-Path $stagedAndroid 'app\build.gradle'
    $gradle = Get-Content -LiteralPath $gradlePath -Raw
    $signingPattern = '(?ms)(^\s{4}signingConfigs\s*\{\s*^\s{8}debug\s*\{.*?^\s{8}\}\s*)(^\s{4}\})'
    $releaseSigning = @'
        release {
            storeFile file(System.getenv("BILLMANAGER_ANDROID_KEYSTORE"))
            storePassword System.getenv("BILLMANAGER_ANDROID_STORE_PASSWORD")
            keyAlias System.getenv("BILLMANAGER_ANDROID_KEY_ALIAS")
            keyPassword System.getenv("BILLMANAGER_ANDROID_KEY_PASSWORD")
        }
'@
    $signingRegex = [regex]::new($signingPattern)
    if (-not $signingRegex.IsMatch($gradle)) {
        throw 'Could not locate the generated Android signing configuration.'
    }
    $gradle = $signingRegex.Replace(
        $gradle,
        { param($match) $match.Groups[1].Value + $releaseSigning + "`r`n" + $match.Groups[2].Value },
        1
    )

    $buildTypesIndex = $gradle.IndexOf('buildTypes {', [System.StringComparison]::Ordinal)
    $releaseIndex = $gradle.IndexOf('release {', $buildTypesIndex, [System.StringComparison]::Ordinal)
    $debugSigningText = 'signingConfig signingConfigs.debug'
    $releaseSigningIndex = $gradle.IndexOf($debugSigningText, $releaseIndex, [System.StringComparison]::Ordinal)
    if ($buildTypesIndex -lt 0 -or $releaseIndex -lt 0 -or $releaseSigningIndex -lt 0) {
        throw 'Could not switch the generated release build to the protected signing key.'
    }
    $versionCodeMatch = [regex]::Match($gradle, '(?m)^\s*versionCode\s+(\d+)\s*$')
    $versionNameMatch = [regex]::Match($gradle, '(?m)^\s*versionName\s+"([^"]+)"\s*$')
    if (-not $versionCodeMatch.Success -or -not $versionNameMatch.Success) {
        throw 'Could not read the generated Android application version.'
    }
    $expectedVersionCode = $versionCodeMatch.Groups[1].Value
    $expectedVersionName = $versionNameMatch.Groups[1].Value
    if ($null -ne $requestedOutputFullPath) {
        $outputFullPath = $requestedOutputFullPath
    }
    else {
        $defaultOutputName = "billmanager-$($package.version)-build$expectedVersionCode-local-phone-test.apk"
        $outputFullPath = [System.IO.Path]::GetFullPath(
            (Join-Path $repoRoot "output\play-store-assets\$defaultOutputName")
        )
    }
    $outputDirectory = Split-Path -Parent $outputFullPath
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $gradle = $gradle.Remove($releaseSigningIndex, $debugSigningText.Length).Insert(
        $releaseSigningIndex,
        'signingConfig signingConfigs.release'
    )
    [System.IO.File]::WriteAllText($gradlePath, $gradle, [System.Text.UTF8Encoding]::new($false))

    Write-Host 'Building the standalone signed release APK with the Android Studio toolchain'
    Push-Location $stagedAndroid
    try {
        $env:BILLMANAGER_ANDROID_KEY_ALIAS = [string]$credentials.android.keystore.keyAlias
        $env:BILLMANAGER_ANDROID_KEY_PASSWORD = [string]$credentials.android.keystore.keyPassword
        $env:BILLMANAGER_ANDROID_KEYSTORE = $keystorePath
        $env:BILLMANAGER_ANDROID_STORE_PASSWORD = [string]$credentials.android.keystore.keystorePassword
        $localGradleInvoked = $true
        Invoke-Checked -Executable (Join-Path $stagedAndroid 'gradlew.bat') -Arguments @(
            'assembleRelease',
            '--daemon',
            '--max-workers=1'
        )
    }
    finally {
        foreach ($name in $signingEnvironmentNames) {
            $oldValue = $savedEnvironment[$name]
            [Environment]::SetEnvironmentVariable($name, $oldValue, 'Process')
        }
        Pop-Location
        if ($localGradleInvoked) {
            try {
                Stop-IsolatedGradleDaemon -Marker $gradleDaemonMarker
                $localGradleDaemonStopped = $true
            }
            catch {
                Write-Warning "Could not immediately stop the isolated local Gradle daemon: $($_.Exception.Message)"
            }
        }
    }

    $builtApk = Join-Path $stagedAndroid 'app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $builtApk -PathType Leaf)) {
        throw 'Gradle completed without producing the expected release APK.'
    }

    $buildTools = Join-Path $androidSdk 'build-tools\36.1.0'
    $apksigner = Join-Path $buildTools 'apksigner.bat'
    $zipalign = Join-Path $buildTools 'zipalign.exe'
    $aapt2 = Join-Path $buildTools 'aapt2.exe'
    $certificateOutput = & $apksigner verify --verbose --print-certs $builtApk 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'The locally built APK failed signature verification.'
    }
    $certificateLine = $certificateOutput | Where-Object { $_ -match 'certificate SHA-256 digest:' } | Select-Object -First 1
    if (-not $certificateLine) {
        throw 'Could not read the APK signing certificate digest.'
    }
    $actualDigest = (($certificateLine -split ':', 2)[1] -replace '[^0-9A-Fa-f]', '').ToLowerInvariant()
    $assetLinks = Get-Content -LiteralPath (Join-Path $stagingPath 'apps\web\public\.well-known\assetlinks.json') -Raw | ConvertFrom-Json
    $expectedDigests = @(
        foreach ($statement in @($assetLinks)) {
            if ($statement.target.namespace -eq 'android_app' -and
                $statement.target.package_name -eq 'com.brdweb.billmanagermobile') {
                foreach ($fingerprint in @($statement.target.sha256_cert_fingerprints)) {
                    (($fingerprint -replace '[^0-9A-Fa-f]', '').ToLowerInvariant())
                }
            }
        }
    )
    if ($expectedDigests.Count -eq 0) {
        throw 'The production Android trust statement has no certificate for the BillManager package.'
    }
    if ($actualDigest -notin $expectedDigests) {
        throw "The APK certificate does not match the production Android trust statement (actual $actualDigest)."
    }

    & $zipalign -c -P 16 -v 4 $builtApk | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'The locally built APK failed 16 KB ZIP alignment verification.'
    }
    $badging = (& $aapt2 dump badging $builtApk 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or
        $badging -notmatch "package: name='com\.brdweb\.billmanagermobile'" -or
        $badging -notmatch "versionCode='$([regex]::Escape($expectedVersionCode))'" -or
        $badging -notmatch "versionName='$([regex]::Escape($expectedVersionName))'" -or
        $badging -notmatch "minSdkVersion:'24'" -or
        $badging -notmatch "targetSdkVersion:'36'" -or
        $badging -notmatch "(?m)^native-code: 'arm64-v8a'\s*$") {
        throw 'The locally built APK has unexpected Android package, version, SDK, or ABI metadata.'
    }
    $manifestTree = (
        & $aapt2 dump xmltree $builtApk --file AndroidManifest.xml 2>&1
    ) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the packaged Android manifest.'
    }
    $updatesEnabledNameCount = [regex]::Matches(
        $manifestTree,
        '="expo\.modules\.updates\.ENABLED"'
    ).Count
    $updatesDisabledPattern = (
        '(?m)^[ \t]*E: meta-data[^\r\n]*\r?\n' +
        '[ \t]+A: [^\r\n]*:name[^\r\n]*="expo\.modules\.updates\.ENABLED"[^\r\n]*\r?\n' +
        '[ \t]+A: [^\r\n]*:value[^\r\n]*=false[ \t]*\r?$'
    )
    if ($updatesEnabledNameCount -ne 1 -or
        -not [regex]::IsMatch($manifestTree, $updatesDisabledPattern)) {
        throw 'The packaged phone-test APK does not explicitly disable Expo Updates.'
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    $apkArchive = $null
    try {
        $apkArchive = [System.IO.Compression.ZipFile]::OpenRead($builtApk)
        $embeddedBundles = @($apkArchive.Entries | Where-Object {
            $_.FullName -eq 'assets/index.android.bundle'
        })
        if ($embeddedBundles.Count -ne 1 -or $embeddedBundles[0].Length -le 0) {
            throw 'The phone-test APK has no usable embedded Android JavaScript bundle.'
        }
    }
    finally {
        if ($null -ne $apkArchive) {
            $apkArchive.Dispose()
        }
    }

    $hash = (Get-FileHash -LiteralPath $builtApk -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $builtApk).Length
    $temporaryOutputName = ".$([System.IO.Path]::GetFileName($outputFullPath)).$shortBuildId.tmp"
    $temporaryOutputPath = Join-Path $outputDirectory $temporaryOutputName
    $backupOutputName = ".$([System.IO.Path]::GetFileName($outputFullPath)).$shortBuildId.bak"
    $backupOutputPath = Join-Path $outputDirectory $backupOutputName
    $rejectedOutputName = ".$([System.IO.Path]::GetFileName($outputFullPath)).$shortBuildId.rejected"
    $rejectedOutputPath = Join-Path $outputDirectory $rejectedOutputName
    try {
        Copy-Item -LiteralPath $builtApk -Destination $temporaryOutputPath -Force
        $temporaryHash = (Get-FileHash -LiteralPath $temporaryOutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($temporaryHash -ne $hash) {
            throw 'The validated APK changed while copying it to the output directory.'
        }
        $destinationExisted = Test-Path -LiteralPath $outputFullPath -PathType Leaf
        $previousHash = $null
        if ($destinationExisted) {
            $previousHash = (
                Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256
            ).Hash.ToLowerInvariant()
            # WSL's Windows share requires a real backup path for File.Replace.
            # Keeping the backup until the destination hash is checked also
            # makes the atomic promotion recoverable if verification fails.
            [System.IO.File]::Replace(
                $temporaryOutputPath,
                $outputFullPath,
                $backupOutputPath,
                $true
            )
        }
        else {
            [System.IO.File]::Move($temporaryOutputPath, $outputFullPath)
        }
        $publishedHash = (
            Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
        if ($publishedHash -ne $hash) {
            if ($destinationExisted) {
                [System.IO.File]::Replace(
                    $backupOutputPath,
                    $outputFullPath,
                    $rejectedOutputPath,
                    $true
                )
                $restoredHash = (
                    Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256
                ).Hash.ToLowerInvariant()
                if ($restoredHash -ne $previousHash) {
                    throw "The published APK hash is invalid and automatic rollback could not verify the previous output."
                }
                if ([System.IO.File]::Exists($rejectedOutputPath)) {
                    [System.IO.File]::Delete($rejectedOutputPath)
                }
                throw 'The published APK hash is invalid; the previous output was restored.'
            }
            [System.IO.File]::Delete($outputFullPath)
            throw 'The published APK hash is invalid; the rejected new output was removed.'
        }
        if ([System.IO.File]::Exists($backupOutputPath)) {
            [System.IO.File]::Delete($backupOutputPath)
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryOutputPath -Force
        }
    }
    Write-Host "APK=$outputFullPath"
    Write-Host "SHA256=$hash"
    Write-Host "SIZE=$size"
    Write-Host "CERTIFICATE_SHA256=$actualDigest"
    $buildSucceeded = $true
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
    if ($localGradleInvoked -and -not $localGradleDaemonStopped) {
        try {
            Stop-IsolatedGradleDaemon -Marker $gradleDaemonMarker
        }
        catch {
            Write-Warning "Could not stop the isolated local Gradle daemon: $($_.Exception.Message)"
        }
    }
    foreach ($name in $environmentNames) {
        $oldValue = $savedEnvironment[$name]
        if ($null -eq $oldValue) {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        else {
            [Environment]::SetEnvironmentVariable($name, [string]$oldValue, 'Process')
        }
    }

    if ($buildSucceeded -and -not $KeepStaging) {
        $resolvedBuildRoot = [System.IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
        $resolvedStaging = [System.IO.Path]::GetFullPath($stagingPath)
        if (-not $resolvedStaging.StartsWith($resolvedBuildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to clean a staging directory outside the local BillManager build root.'
        }
        try {
            Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
        }
        catch {
            Write-Warning "The APK is valid, but the disposable build directory could not be fully removed: $resolvedStaging"
            Write-Host "STAGING=$resolvedStaging"
        }
    }
    elseif (-not $buildSucceeded) {
        Write-Warning "The failed build staging directory was preserved at $stagingPath"
    }
    elseif ($KeepStaging) {
        Write-Host "STAGING=$stagingPath"
    }
}
