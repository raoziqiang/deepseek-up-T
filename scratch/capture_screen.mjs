import { execSync } from 'node:child_process';

const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$outPath = 'C:\\Users\\Z1848\\.gemini\\antigravity\\brain\\5297fee8-79b6-414c-9177-1f8cbee681d0\\current_desktop.png'
$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Host "Desktop captured to $outPath"
`;

execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, '; ')}"`, { stdio: 'inherit' });
