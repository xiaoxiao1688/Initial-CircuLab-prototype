$ErrorActionPreference = "Stop"

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$port = 9229
$targetUrl = "http://127.0.0.1:8765/index.html"
$profileDir = Join-Path $PSScriptRoot "..\.edge-debug-ps"
$outputPath = Join-Path $PSScriptRoot "..\debug_page_output.json"

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$edge = Start-Process -FilePath $edgePath -ArgumentList @(
  "--remote-debugging-port=$port",
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-crash-reporter",
  "--user-data-dir=$profileDir",
  $targetUrl
) -PassThru

function Receive-JsonMessage {
  param([System.Net.WebSockets.ClientWebSocket]$Socket)

  $buffer = New-Object byte[] 65536
  $segment = [ArraySegment[byte]]::new($buffer)
  $stream = New-Object System.IO.MemoryStream

  while ($true) {
    $result = $Socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($result.Count -gt 0) {
      $stream.Write($buffer, 0, $result.Count)
    }
    if ($result.EndOfMessage) {
      break
    }
  }

  $json = [Text.Encoding]::UTF8.GetString($stream.ToArray())
  return $json | ConvertFrom-Json -Depth 20
}

function Send-JsonMessage {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Json
  )

  $bytes = [Text.Encoding]::UTF8.GetBytes($Json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $Socket.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult()
}

try {
  $version = $null
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $version = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing
      if ($version.webSocketDebuggerUrl) { break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }

  if (-not $version.webSocketDebuggerUrl) {
    throw "Unable to connect to Edge browser debugging endpoint."
  }

  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([Uri]$version.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

  $nextId = 1
  $sessionId = $null
  $consoleEvents = @()
  $pageEvents = @()

  Send-JsonMessage $socket (@{ id = $nextId; method = "Target.getTargets"; params = @{} } | ConvertTo-Json -Compress -Depth 10)
  $targetsResponse = Receive-JsonMessage $socket
  $nextId++

  $pageTarget = $targetsResponse.result.targetInfos | Where-Object { $_.url -eq $targetUrl } | Select-Object -First 1
  if (-not $pageTarget) {
    $pageTarget = $targetsResponse.result.targetInfos | Where-Object { $_.type -eq "page" } | Select-Object -First 1
  }
  if (-not $pageTarget) {
    throw "Unable to find page target."
  }

  Send-JsonMessage $socket (@{
    id = $nextId
    method = "Target.attachToTarget"
    params = @{
      targetId = $pageTarget.targetId
      flatten = $true
    }
  } | ConvertTo-Json -Compress -Depth 10)

  while (-not $sessionId) {
    $message = Receive-JsonMessage $socket
    if ($message.method -eq "Target.attachedToTarget") {
      $sessionId = $message.params.sessionId
    }
    if ($message.id -eq $nextId -and $message.result.sessionId) {
      $sessionId = $message.result.sessionId
    }
  }
  $nextId++

  foreach ($method in @("Runtime.enable", "Page.enable")) {
    Send-JsonMessage $socket (@{
      id = $nextId
      method = $method
      params = @{}
      sessionId = $sessionId
    } | ConvertTo-Json -Compress -Depth 10)
    [void](Receive-JsonMessage $socket)
    $nextId++
  }

  Send-JsonMessage $socket (@{
    id = $nextId
    method = "Page.reload"
    params = @{ ignoreCache = $true }
    sessionId = $sessionId
  } | ConvertTo-Json -Compress -Depth 10)
  [void](Receive-JsonMessage $socket)
  $nextId++

  $deadline = (Get-Date).AddSeconds(4)
  while ((Get-Date) -lt $deadline) {
    if ($socket.Available -gt 0) {
      $message = Receive-JsonMessage $socket
      if ($message.sessionId -eq $sessionId -and $message.method -eq "Runtime.consoleAPICalled") {
        $consoleEvents += $message.params
      }
      if ($message.sessionId -eq $sessionId -and $message.method -eq "Runtime.exceptionThrown") {
        $consoleEvents += @{ type = "exception"; details = $message.params.exceptionDetails }
      }
      if ($message.sessionId -eq $sessionId -and $message.method -eq "Page.loadEventFired") {
        $pageEvents += $message.method
      }
    } else {
      Start-Sleep -Milliseconds 100
    }
  }

  Send-JsonMessage $socket (@{
    id = $nextId
    method = "Runtime.evaluate"
    params = @{
      expression = "(() => ({title: document.title, levelCards: document.querySelectorAll('.level-card').length, paletteCards: document.querySelectorAll('.component-card--palette').length, boardComponents: document.querySelectorAll('.board-component').length, activeComponentsText: document.querySelector('#active-components')?.innerText || '', wiringStatus: document.querySelector('#wiring-status')?.textContent || '', bodyText: document.body?.innerText?.slice(0, 400) || ''}))()"
      returnByValue = $true
    }
    sessionId = $sessionId
  } | ConvertTo-Json -Compress -Depth 20)
  $evalResponse = Receive-JsonMessage $socket

  @{
    pageEvents = $pageEvents
    consoleEvents = $consoleEvents
    evaluation = $evalResponse.result.result.value
  } | ConvertTo-Json -Depth 20 | Set-Content -Path $outputPath -Encoding UTF8

  $socket.Dispose()
}
catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json | Set-Content -Path $outputPath -Encoding UTF8
  throw
}
finally {
  Stop-Process -Id $edge.Id -Force -ErrorAction SilentlyContinue
}
