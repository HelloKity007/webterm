import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const run = promisify(execFile);
const encode = text => Buffer.from(text, 'utf16le').toString('base64');

// Task Scheduler accepts the small control task reliably, but can silently
// refuse a large `-EncodedCommand` action after the C# input helper is
// embedded. Stage that action as a uniquely named temporary file instead.
// The control body itself still travels over SSH stdin, so no command line
// needs to contain the large program text. Every path is task-specific and is
// removed by the same control task after its result has been collected.
function scheduledTaskControl(name, resultPath, interaction) {
  const scriptPath = `${resultPath}.ps1`;
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$name = '${name}'
$path = '${resultPath}'
$scriptPath = '${scriptPath}'
$source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encode(interaction)}'))
[IO.File]::WriteAllText($scriptPath, $source, [Text.Encoding]::UTF8)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"')
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
try {
  Register-ScheduledTask -TaskName $name -Action $action -Principal $principal | Out-Null
  Start-ScheduledTask -TaskName $name
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Raw; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path -LiteralPath $path)) { throw 'Native input task did not produce a result' }
} finally {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
}
`;
}

// Runs in the logged-in Windows desktop, not SSH's non-interactive session.
// Verify the explicitly titled real browser window, never its shell tab proxy.
export async function sendWindowsNativeReload(key = 'Control+Shift+R') {
  const keys = { F5: '{F5}', 'Control+R': '^r', 'Control+Shift+R': '^+r' };
  if (!Object.hasOwn(keys, key)) throw new Error('Unsupported native QA key');
  const inputSource = await readFile(new URL('./windows-native-input.cs', import.meta.url), 'utf8');
  const name = `WebTermStrictQA-Key-${randomUUID()}`;
  const resultPath = `C:\\Users\\admin\\AppData\\Local\\Temp\\${name}.json`;
  const interaction = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -TypeDefinition '${inputSource.replaceAll("'", "''")}'
  [QAInput]::ActivateOwnedBrowser()
  Start-Sleep -Milliseconds 150
  Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class QAWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int count); [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder value, int length, out int needed); [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h); }'
  $desktop = [QAWindow]::OpenInputDesktop(0, $false, 1)
  if ($desktop -eq [IntPtr]::Zero) { throw ('Interactive input desktop unavailable: Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  $desktopName = New-Object System.Text.StringBuilder 512
  $needed = 0
  try { [QAWindow]::GetUserObjectInformation($desktop, 2, $desktopName, 1024, [ref]$needed) | Out-Null }
  finally { [QAWindow]::CloseDesktop($desktop) | Out-Null }
  if ($desktopName.ToString() -ne 'Default') { throw ('Input desktop is not unlocked Default: ' + $desktopName.ToString()) }
  $caption = New-Object System.Text.StringBuilder 512
  [QAWindow]::GetWindowText([QAWindow]::GetForegroundWindow(), $caption, 512) | Out-Null
  if (-not $caption.ToString().StartsWith('WebTerm-native-reload-QA')) { throw 'Foreground window is not the QA window; no key sent' }
  $focusBefore = [QAInput]::FocusObservation()
  $accepted = [QAInput]::Reload($${key !== 'F5'}, $${key === 'Control+Shift+R'})
  if ($accepted -ne [QAInput]::Expected) { throw ('OS accepted ' + $accepted + '/' + [QAInput]::Expected + ' events; Win32 error ' + [QAInput]::LastError) }
  Start-Sleep -Milliseconds 500
  $result = @{ ok = $true; key = '${key}'; acceptedEvents = $accepted; expectedEvents = [QAInput]::Expected; focusBefore = $focusBefore; focusAfter = [QAInput]::FocusObservation() }
} catch { $result = @{ ok = $false; error = $_.Exception.Message } }
$result | ConvertTo-Json -Compress | Set-Content -LiteralPath '${resultPath}.pending' -Encoding UTF8
# Publish only after the writer closes the file. Existence alone otherwise
# races Get-Content against Set-Content's exclusive Windows file handle.
Move-Item -LiteralPath '${resultPath}.pending' -Destination '${resultPath}'
`;
  const control = scheduledTaskControl(name, resultPath, interaction);
  // Nested EncodedCommand bodies exceed cmd.exe's command-line limit. Carry
  // the control script on stdin; keep only a small fixed bootstrap in argv.
  const bootstrap = '[ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String([Console]::ReadLine()))).Invoke()';
  const execution = run('ssh', ['-o', 'BatchMode=yes', '185', `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encode(bootstrap)}`], { timeout: 30000 });
  execution.child.stdin.end(`${encode(control)}\n`);
  const { stdout } = await execution;
  const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!result.ok) throw new Error(result.error || 'Windows native key failed');
  return result;
}

// Sends actual OS mouse input only to a specifically titled popup in the
// dedicated Windows QA profile.  It is intentionally not a generic remote
// input primitive: callers must supply the two exact titles and screen points
// measured from their CDP-owned pages, and browser-side assertions prove the
// drop actually happened.
export async function sendWindowsNativeDrag({ sourceTitle, sourcePoint, targetPoint, steps = 18 }) {
  if (!/^WebTerm-native-file-source$/.test(sourceTitle)) throw new Error('Unexpected native drag source title');
  for (const point of [sourcePoint, targetPoint]) {
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0) {
      throw new Error('Native drag points must be non-negative integer screen coordinates');
    }
  }
  if (!Number.isInteger(steps) || steps < 2 || steps > 100) throw new Error('Native drag step count is invalid');
  const inputSource = await readFile(new URL('./windows-native-input.cs', import.meta.url), 'utf8');
  const name = `WebTermStrictQA-Drag-${randomUUID()}`;
  const resultPath = `C:\\Users\\admin\\AppData\\Local\\Temp\\${name}.json`;
  const interaction = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -TypeDefinition '${inputSource.replaceAll("'", "''")}'
  $accepted = [QAInput]::DragOwnedBrowser('${sourceTitle}', ${sourcePoint.x}, ${sourcePoint.y}, ${targetPoint.x}, ${targetPoint.y}, ${steps})
  if ($accepted -ne [QAInput]::Expected) { throw ('OS accepted ' + $accepted + '/' + [QAInput]::Expected + ' mouse events; Win32 error ' + [QAInput]::LastError) }
  $result = @{ ok = $true; acceptedEvents = $accepted; expectedEvents = [QAInput]::Expected; source = '${sourceTitle}'; pointerMetrics = [QAInput]::PointerMetrics() }
} catch { $result = @{ ok = $false; error = $_.Exception.Message } }
$result | ConvertTo-Json -Compress | Set-Content -LiteralPath '${resultPath}.pending' -Encoding UTF8
Move-Item -LiteralPath '${resultPath}.pending' -Destination '${resultPath}'
`;
  const control = scheduledTaskControl(name, resultPath, interaction);
  const bootstrap = '[ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String([Console]::ReadLine()))).Invoke()';
  const execution = run('ssh', ['-o', 'BatchMode=yes', '185', `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encode(bootstrap)}`], { timeout: 30000 });
  execution.child.stdin.end(`${encode(control)}\n`);
  const { stdout } = await execution;
  const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!result.ok) throw new Error(result.error || 'Windows native drag failed');
  return result;
}

export async function sendWindowsNativeClick({ sourceTitle, point }) {
  if (!/^WebTerm-native-file-source$/.test(sourceTitle)) throw new Error('Unexpected native click source title');
  if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0) {
    throw new Error('Native click point must be a non-negative integer screen coordinate');
  }
  const inputSource = await readFile(new URL('./windows-native-input.cs', import.meta.url), 'utf8');
  const name = `WebTermStrictQA-Click-${randomUUID()}`;
  const resultPath = `C:\\Users\\admin\\AppData\\Local\\Temp\\${name}.json`;
  const interaction = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -TypeDefinition '${inputSource.replaceAll("'", "''")}'
  $accepted = [QAInput]::ClickOwnedBrowser('${sourceTitle}', ${point.x}, ${point.y})
  if ($accepted -ne [QAInput]::Expected) { throw ('OS accepted ' + $accepted + '/' + [QAInput]::Expected + ' mouse events; Win32 error ' + [QAInput]::LastError) }
  $result = @{ ok = $true; acceptedEvents = $accepted; expectedEvents = [QAInput]::Expected; source = '${sourceTitle}'; pointerMetrics = [QAInput]::PointerMetrics() }
} catch { $result = @{ ok = $false; error = $_.Exception.Message } }
$result | ConvertTo-Json -Compress | Set-Content -LiteralPath '${resultPath}.pending' -Encoding UTF8
Move-Item -LiteralPath '${resultPath}.pending' -Destination '${resultPath}'
`;
  const control = scheduledTaskControl(name, resultPath, interaction);
  const bootstrap = '[ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String([Console]::ReadLine()))).Invoke()';
  const execution = run('ssh', ['-o', 'BatchMode=yes', '185', `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encode(bootstrap)}`], { timeout: 30000 });
  execution.child.stdin.end(`${encode(control)}\n`);
  const { stdout } = await execution;
  const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  if (!result.ok) throw new Error(result.error || 'Windows native click failed');
  return result;
}
