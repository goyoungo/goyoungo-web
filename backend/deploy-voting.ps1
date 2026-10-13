param(
    [Parameter(Mandatory = $true)][string]$ArtifactBucket,
    [string]$AwsCli = 'aws',
    [string]$Profile = 'default',
    [string]$Region = 'ap-northeast-3',
    [string]$StackName = 'goyoungo-voting-prod',
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'

function Invoke-Aws {
    param([string[]]$Arguments)
    $output = & $AwsCli @Arguments --profile $Profile --region $Region --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw "AWS command failed: $($Arguments[0..1] -join ' ')" }
    return ($output -join "`n")
}

# Upload bytes directly. cloudformation deploy may re-encode a Unicode
# template using the Windows locale when staging a large template in S3.
$template = Join-Path $PSScriptRoot 'voting-stack.yaml'
$bytes = [System.IO.File]::ReadAllBytes($template)
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$text = $utf8.GetString($bytes)
if ($text.Contains([string][char]0xfffd)) { throw 'Template contains a Unicode replacement character.' }
$hash = (Get-FileHash -LiteralPath $template -Algorithm SHA256).Hash.ToLowerInvariant()
$key = "voting/utf8/$hash.yaml"
Invoke-Aws -Arguments @('s3', 'cp', $template, "s3://$ArtifactBucket/$key", '--content-type', 'application/yaml', '--sse', 'AES256', '--only-show-errors') | Out-Null

# Confirm the uploaded template is byte-for-byte identical before creating
# any CloudFormation change. No secrets or parameter values are printed.
$download = [System.IO.Path]::GetTempFileName()
try {
    Invoke-Aws -Arguments @('s3api', 'get-object', '--bucket', $ArtifactBucket, '--key', $key, $download) | Out-Null
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
        throw 'Uploaded template checksum does not match the local UTF-8 source.'
    }
} finally {
    Remove-Item -LiteralPath $download -Force
}

$parameterKeys = Invoke-Aws -Arguments @('cloudformation', 'describe-stacks', '--stack-name', $StackName, '--query', 'Stacks[0].Parameters[].ParameterKey', '--output', 'json') | ConvertFrom-Json
$changeSet = 'utf8-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$arguments = @(
    'cloudformation', 'create-change-set', '--stack-name', $StackName,
    '--change-set-name', $changeSet, '--change-set-type', 'UPDATE',
    '--template-url', "https://$ArtifactBucket.s3.$Region.amazonaws.com/$key",
    '--capabilities', 'CAPABILITY_NAMED_IAM', '--parameters'
)
foreach ($parameterKey in $parameterKeys) {
    $arguments += "ParameterKey=$parameterKey,UsePreviousValue=true"
}
Invoke-Aws -Arguments $arguments | Out-Null
Invoke-Aws -Arguments @('cloudformation', 'wait', 'change-set-create-complete', '--stack-name', $StackName, '--change-set-name', $changeSet) | Out-Null
$changes = Invoke-Aws -Arguments @('cloudformation', 'describe-change-set', '--stack-name', $StackName, '--change-set-name', $changeSet, '--query', 'Changes[].ResourceChange.{Action:Action,Resource:LogicalResourceId,Replacement:Replacement}', '--output', 'json') | ConvertFrom-Json
if ($changes | Where-Object { $_.Action -eq 'Remove' -or $_.Replacement -eq 'True' }) {
    throw "Destructive resource change detected. Review change set $changeSet manually."
}
Write-Host "Verified UTF-8 template SHA256: $hash"
Write-Host "Prepared change set: $changeSet"
Write-Host ($changes | ConvertTo-Json -Depth 5)

if ($Execute) {
    Invoke-Aws -Arguments @('cloudformation', 'execute-change-set', '--stack-name', $StackName, '--change-set-name', $changeSet) | Out-Null
    Invoke-Aws -Arguments @('cloudformation', 'wait', 'stack-update-complete', '--stack-name', $StackName) | Out-Null
    Write-Host 'Stack UPDATE_COMPLETE. Verify the deployed Lambda before publishing the frontend.'
}
