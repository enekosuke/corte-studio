param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $project '.corte-data'
$localUrl = 'http://127.0.0.1:4173'
$proxyTarget = 'http://127.0.0.1:4176'
$remoteUrlFile = Join-Path $data 'remote-url.txt'
$remoteLog = Join-Path $data 'remote-start.log'
New-Item -ItemType Directory -Path $data -Force | Out-Null

function Test-Studio {
    try {
        $response = Invoke-WebRequest "$localUrl/api/engines" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Headers['Content-Type'] -like 'application/json*'
    } catch { return $false }
}

function Start-StudioNode($entry, $logName) {
    Start-Process -FilePath $node -ArgumentList $entry -WorkingDirectory $project -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $data "$logName.out.log") `
        -RedirectStandardError (Join-Path $data "$logName.err.log")
}

function Test-RemoteProxy {
    try {
        $response = Invoke-WebRequest "$proxyTarget/__corte_proxy_check" -Headers @{
            Host = $authority
            'X-Forwarded-Proto' = 'https'
            'Tailscale-User-Login' = $login
        } -UseBasicParsing -TimeoutSec 2
        return $response.Content -eq 'Corte Studio'
    } catch { return $false }
}

function Get-JsonProperty($object, [string]$name) {
    if ($null -ne $object) { $object.PSObject.Properties[$name].Value }
}

$launchLock = [Threading.Mutex]::new($false, 'Local\CorteStudio-Start-4173')
$hasLock = $false
try {
    try { $hasLock = $launchLock.WaitOne(20000) } catch [Threading.AbandonedMutexException] { $hasLock = $true }
    if (!$hasLock) { throw 'Corte Studio ya se esta iniciando.' }
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    if (!(Test-Studio)) {
        $serverArgs = if (Test-Path -LiteralPath (Join-Path $project '.env')) {
            '--env-file=.env server.mjs'
        } else { 'server.mjs' }
        Start-StudioNode $serverArgs 'desktop-server'
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 300
            $ready = Test-Studio
        } until ($ready -or [DateTime]::UtcNow -ge $deadline)
        if (!$ready) { throw "El servidor de Corte Studio no arranco. Consulta $data\desktop-server.err.log" }
    }
    if (!$NoBrowser) { Start-Process "$localUrl/" }

    try {
        $tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
        if (!(Test-Path -LiteralPath $tailscale)) { throw 'Instala Tailscale y vincula el equipo con tu cuenta.' }
        $status = & $tailscale status --json | ConvertFrom-Json
        if ($status.BackendState -ne 'Running') { throw 'Vincula o conecta este PC a tu cuenta de Tailscale.' }
        $dns = $status.Self.DNSName.TrimEnd('.')
        $login = (Get-JsonProperty $status.User $status.Self.UserID).LoginName
        if ($dns -notmatch '^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$' -or !$login) {
            throw 'Tailscale no facilito una direccion HTTPS y una cuenta para el equipo.'
        }

        $serve = & $tailscale serve status --json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw 'No pude consultar la configuracion de Tailscale Serve.' }
        $existingPort = $null
        $freePort = $null
        foreach ($candidate in @(443, 8443)) {
            $key = "${dns}:$candidate"
            $tcp = Get-JsonProperty $serve.TCP $candidate
            $web = Get-JsonProperty $serve.Web $key
            $handler = Get-JsonProperty $web.Handlers '/'
            $funnel = Get-JsonProperty $serve.AllowFunnel $key
            if ($tcp.HTTPS -and $handler.Proxy -eq $proxyTarget -and !$funnel) {
                $existingPort = $candidate
                break
            }
            if (!$tcp -and !$web -and !$funnel -and !$freePort) { $freePort = $candidate }
        }
        $httpsPort = if ($existingPort) { $existingPort } else { $freePort }
        if (!$httpsPort) { throw 'Los puertos HTTPS de Corte Studio ya tienen otros servicios de Tailscale.' }
        $authority = if ($httpsPort -eq 443) { $dns } else { "${dns}:$httpsPort" }
        $config = @{ authority = $authority; login = $login } | ConvertTo-Json -Compress
        $configFile = Join-Path $data 'remote-access.json'
        [IO.File]::WriteAllText($configFile, $config)
        if (!(Test-RemoteProxy)) {
            Start-StudioNode 'scripts/corte-tailnet-proxy.mjs' 'desktop-proxy'
            $deadline = [DateTime]::UtcNow.AddSeconds(5)
            do {
                Start-Sleep -Milliseconds 250
                $ready = Test-RemoteProxy
            } until ($ready -or [DateTime]::UtcNow -ge $deadline)
            if (!$ready) { throw "El proxy local no arranco. Consulta $data\desktop-proxy.err.log" }
        }

        if (!$existingPort) {
            if ($status.CertDomains -notcontains $dns) {
                $dnsSettings = 'https://login.tailscale.com/admin/dns'
                if (!$NoBrowser) { Start-Process $dnsSettings }
                throw "Activa MagicDNS y los certificados HTTPS en $dnsSettings y vuelve a abrir Corte Studio."
            }
            $previous = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $result = & $tailscale serve --bg "--https=$httpsPort" $proxyTarget 2>&1
                $serveExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previous }
            if ($serveExit -ne 0) { throw ($result -join "`n") }
            $serve = & $tailscale serve status --json | ConvertFrom-Json
            $key = "${dns}:$httpsPort"
            $web = Get-JsonProperty $serve.Web $key
            $handler = Get-JsonProperty $web.Handlers '/'
            if ($handler.Proxy -ne $proxyTarget -or (Get-JsonProperty $serve.AllowFunnel $key)) {
                throw 'No pude confirmar la configuracion del tunel privado de Corte Studio.'
            }
        }
        $remoteUrl = "https://$authority/"
        Set-Content -LiteralPath $remoteUrlFile -Value $remoteUrl -Encoding ascii
        Set-Content -LiteralPath $remoteLog -Value "URL de Tailscale Serve $remoteUrl"
        Write-Output $remoteUrl
    } catch {
        if (Test-Path -LiteralPath $remoteUrlFile) { Clear-Content -LiteralPath $remoteUrlFile }
        Set-Content -LiteralPath $remoteLog -Value $_.Exception.Message
        Write-Warning $_.Exception.Message
    }
} catch {
    Set-Content -LiteralPath (Join-Path $data 'desktop-start.err.log') -Value $_.Exception.Message
    if (!$NoBrowser) {
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup($_.Exception.Message, 0, 'Corte Studio', 16)
    }
    throw
} finally {
    if ($hasLock) { $launchLock.ReleaseMutex() }
    $launchLock.Dispose()
}
