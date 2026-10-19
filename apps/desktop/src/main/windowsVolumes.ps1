# Surco's USB export: the lettered volumes of this PC with what the removable filter needs.
# Read-only. With a drive letter argument ('E:'), only that volume.
$ErrorActionPreference = 'SilentlyContinue'
$only = $args[0]
$vols = Get-CimInstance -ClassName Win32_Volume | Where-Object { $_.DriveLetter -and (-not $only -or $_.DriveLetter -eq $only) }
$out = foreach ($v in $vols) {
  $bus = $null
  $style = $null
  $part = Get-Partition -DriveLetter $v.DriveLetter.TrimEnd(':')
  if ($part) {
    $disk = $part | Get-Disk
    if ($disk) { $bus = [string]$disk.BusType; $style = [string]$disk.PartitionStyle }
  }
  [pscustomobject]@{
    DeviceID = $v.DeviceID; DriveLetter = $v.DriveLetter; Label = $v.Label; FileSystem = $v.FileSystem
    Capacity = [double]$v.Capacity; FreeSpace = [double]$v.FreeSpace; DriveType = [int]$v.DriveType
    SerialNumber = [double]$v.SerialNumber; BusType = $bus; PartitionStyle = $style
    SystemVolume = [bool]$v.SystemVolume; BootVolume = [bool]$v.BootVolume
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 2
