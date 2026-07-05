param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

function Fail {
    param([string]$Message)
    throw "[candidate-package-validation] $Message"
}

function To-RepoPath {
    param([string]$RelativePath)
    return (Join-Path $Root ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar))
}

function Count-CsvRows {
    param([string]$Path)
    return (Import-Csv -LiteralPath $Path | Measure-Object).Count
}

$manifestPath = To-RepoPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    Fail "missing manifest.json at $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

Write-Host "Validating 2026 congressional candidate package at $Root"

foreach ($hashEntry in $manifest.outputs_sha256.PSObject.Properties) {
    $relativePath = $hashEntry.Name
    $expectedHash = [string]$hashEntry.Value
    $absolutePath = To-RepoPath $relativePath

    if (-not (Test-Path -LiteralPath $absolutePath)) {
        Fail "missing hashed file: $relativePath"
    }

    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $absolutePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash.ToLowerInvariant()) {
        Fail "hash mismatch for $relativePath. expected=$expectedHash actual=$actualHash"
    }
}

$selectedPath = To-RepoPath $manifest.outputs.selected_csv
$minimalPath = To-RepoPath $manifest.outputs.minimal_csv
$activePath = To-RepoPath $manifest.outputs.active_csv
$allStatusesPath = To-RepoPath $manifest.outputs.all_statuses_csv

$expectedSelected = [int]$manifest.row_counts.active_selected
$expectedActive = [int]$manifest.row_counts.active_C_or_F
$expectedAllStatuses = [int]$manifest.row_counts.all_statuses

$csvExpectations = @(
    @{ Path = $selectedPath; Label = 'selected'; Expected = $expectedSelected },
    @{ Path = $minimalPath; Label = 'minimal'; Expected = $expectedSelected },
    @{ Path = $activePath; Label = 'active'; Expected = $expectedActive },
    @{ Path = $allStatusesPath; Label = 'all_statuses'; Expected = $expectedAllStatuses }
)

foreach ($expectation in $csvExpectations) {
    if (-not (Test-Path -LiteralPath $expectation.Path)) {
        Fail "missing CSV for $($expectation.Label): $($expectation.Path)"
    }

    $actualCount = Count-CsvRows $expectation.Path
    if ($actualCount -ne $expectation.Expected) {
        Fail "row count mismatch for $($expectation.Label). expected=$($expectation.Expected) actual=$actualCount"
    }
}

$activeRows = @(Import-Csv -LiteralPath $activePath)
$badActiveStatuses = @($activeRows | Where-Object { $_.candidate_status_code -notin @('C', 'F') })
if ($badActiveStatuses.Count -gt 0) {
    Fail "active CSV contains non-active FEC statuses: $($badActiveStatuses[0].candidate_status_code)"
}

$officeCounts = $activeRows | Group-Object office | ForEach-Object {
    [PSCustomObject]@{ Office = $_.Name; Count = $_.Count }
}
foreach ($officeCount in $officeCounts) {
    $expected = [int]$manifest.counts_by_office.$($officeCount.Office)
    if ($officeCount.Count -ne $expected) {
        Fail "office count mismatch for $($officeCount.Office). expected=$expected actual=$($officeCount.Count)"
    }
}

$sqlitePath = To-RepoPath $manifest.outputs.sqlite
$sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
if ($sqlite3) {
    $sqliteCount = & $sqlite3.Source $sqlitePath 'SELECT COUNT(*) FROM candidates;'
    if ([int]$sqliteCount -ne $expectedSelected) {
        Fail "SQLite candidate count mismatch. expected=$expectedSelected actual=$sqliteCount"
    }
} else {
    Write-Host "sqlite3 not found; SQLite row count skipped, file hash verified."
}

Write-Host "Candidate package validation passed."
