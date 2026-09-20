param([Parameter(Mandatory=$true)][string]$StatePath, [int]$Port = 8797)
$ErrorActionPreference = 'Stop'
$resolvedState = (Resolve-Path -LiteralPath $StatePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedState 'v3\d1'))) {
    throw 'Expected existing Wrangler persistence with v3/d1. Refusing to start against an empty database.'
}
Write-Host "LOCAL REVIEW: persistent D1/R2 at $resolvedState"
& npx wrangler dev --local --port $Port --persist-to $resolvedState --var ENVIRONMENT:development --var JWT_SECRET:local-ui-review-only-not-production
exit $LASTEXITCODE
