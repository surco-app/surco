const { execFileSync } = require('child_process')
const { join } = require('path')

// electron-builder skips signing without a Developer ID certificate, which
// leaves the bundle with an invalid signature — and on Apple Silicon macOS
// kills it at launch. We ad-hoc sign the whole bundle here (with the JIT
// entitlements V8 needs) so the app runs on any Mac for testing. Distribution
// to other users still needs a right-click → Open the first time (unsigned for
// distribution / not notarized).
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // When a real Developer ID certificate is present (CI release), electron-builder
  // signs and notarizes the bundle itself — ad-hoc re-signing here would clobber
  // that signature, so this hook is only for local unsigned test builds.
  if (process.env.CSC_LINK) return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const entitlements = join(__dirname, 'entitlements.mac.plist')
  execFileSync(
    'codesign',
    ['--force', '--deep', '--options', 'runtime', '--entitlements', entitlements, '--sign', '-', appPath],
    { stdio: 'inherit' }
  )
}
